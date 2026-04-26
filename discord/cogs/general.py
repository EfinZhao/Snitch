import asyncio
import contextlib
from datetime import UTC, datetime, timedelta
import json
import os
import re
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import aiohttp
import discord
from discord.ext import commands
from discord.ext.commands import Context

from .auth import AuthClient


def parse_money_amount(raw: str) -> Optional[float]:
    cleaned = raw.strip().replace("$", "").replace(",", "")
    try:
        value = float(cleaned)
    except ValueError:
        return None
    if value <= 0:
        return None
    return round(value, 2)


def parse_duration_seconds(raw: str) -> Optional[int]:
    text = raw.strip().lower().replace(" ", "")
    if not text:
        return None

    if text.isdigit():
        # Plain numbers are interpreted as minutes.
        minutes = int(text)
        return minutes * 60 if minutes > 0 else None

    match = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", text)
    if not match:
        return None

    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    total_seconds = (hours * 3600) + (minutes * 60) + seconds
    return total_seconds if total_seconds > 0 else None


def format_duration(seconds: int) -> str:
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    parts = []
    if hours:
        parts.append(f"{hours}h")
    if minutes:
        parts.append(f"{minutes}m")
    if secs or not parts:
        parts.append(f"{secs}s")
    return " ".join(parts)


def make_snitch_embed(description: str, is_error: bool = False) -> discord.Embed:
    color = 0xE02B2B if is_error else 0x2F80ED
    return discord.Embed(title="Stake", description=description, color=color)


class RecipientModeView(discord.ui.View):
    def __init__(self, author_id: int) -> None:
        super().__init__(timeout=120)
        self.author_id = author_id
        self.mode: Optional[str] = None

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                "Only the command starter can choose this option.", ephemeral=True
            )
            return False
        return True

    @discord.ui.button(label="Mention Recipients", style=discord.ButtonStyle.primary)
    async def mention_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        self.mode = "mention"
        for child in self.children:
            child.disabled = True
        await interaction.response.edit_message(
            embed=make_snitch_embed("Recipient mode: **Mention Recipients**"), view=self
        )
        self.stop()

    @discord.ui.button(label="Anyone Can Join", style=discord.ButtonStyle.success)
    async def anyone_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        self.mode = "anyone"
        for child in self.children:
            child.disabled = True
        await interaction.response.edit_message(
            embed=make_snitch_embed("Recipient mode: **Anyone Can Join**"), view=self
        )
        self.stop()


class AuthActionView(discord.ui.View):
    def __init__(self, signup_url: Optional[str], payment_url: Optional[str]) -> None:
        super().__init__(timeout=300)
        if signup_url:
            self.add_item(
                discord.ui.Button(
                    label="Create & Link Snitch Account",
                    style=discord.ButtonStyle.link,
                    url=signup_url,
                )
            )
        if payment_url:
            self.add_item(
                discord.ui.Button(
                    label="Set Up Payment Method",
                    style=discord.ButtonStyle.link,
                    url=payment_url,
                )
            )


class StartStakeView(discord.ui.View):
    def __init__(self, start_url: str, author_id: int) -> None:
        super().__init__(timeout=3600)
        self.start_url = start_url
        self.author_id = author_id

    @discord.ui.button(label="Open Snitch & Start Session", style=discord.ButtonStyle.primary)
    async def open_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                "Only the stake creator can start the session.", ephemeral=True
            )
            return
        button.disabled = True
        await interaction.response.edit_message(view=self)
        await interaction.followup.send(self.start_url, ephemeral=True)


class LobbyView(discord.ui.View):
    def __init__(self, author_id: int, max_recipients: int, amount: float, duration_seconds: int, auth_client: "AuthClient") -> None:
        super().__init__(timeout=300)
        self.author_id = author_id
        self.max_recipients = max_recipients
        self.amount = amount
        self.duration_seconds = duration_seconds
        self.auth_client = auth_client
        self.joined: dict[int, discord.abc.User] = {}
        self.started = False

    def _details_text(self) -> str:
        recipient_mentions = (
            ", ".join(u.mention for u in self.joined.values()) if self.joined else "none yet"
        )
        return (
            f"**Lobby open** — waiting for recipients to join.\n"
            f"Bet: **${self.amount:.2f}** | Duration: **{format_duration(self.duration_seconds)}**\n"
            f"Slots filled: **{len(self.joined)}/{self.max_recipients}**\n"
            f"Joined: {recipient_mentions}\n\n"
            "Once at least one person has joined, the creator can press **Start Session**."
        )

    @discord.ui.button(label="Join", style=discord.ButtonStyle.success)
    async def join_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        user = interaction.user
        if user.bot or user.id == self.author_id:
            await interaction.response.send_message("You cannot join this stake.", ephemeral=True)
            return
        if user.id in self.joined:
            await interaction.response.send_message("You already joined this lobby.", ephemeral=True)
            return
        if len(self.joined) >= self.max_recipients:
            await interaction.response.send_message("Lobby is full.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True, thinking=True)

        status_ok, status_msg, status = await self.auth_client.get_discord_account_status(user.id)
        if not status_ok or status is None:
            await interaction.followup.send(f"Could not verify your Snitch account: {status_msg}", ephemeral=True)
            return
        if not status.get("exists"):
            signup_url = self.auth_client.signup_url_with_discord_uid(user.id)
            await interaction.followup.send(
                f"You need a Snitch account to join.\nSign up here: {signup_url}",
                ephemeral=True,
            )
            return
        if not status.get("payout_ready"):
            await interaction.followup.send(
                f"You need to complete Stripe Connect onboarding before joining.\n"
                f"Set it up here: {self.auth_client.frontend_payment_setup_url}",
                ephemeral=True,
            )
            return

        self.joined[user.id] = user
        await interaction.followup.send("You've joined the lobby!", ephemeral=True)
        await interaction.message.edit(embed=make_snitch_embed(self._details_text()), view=self)

    @discord.ui.button(label="Start Session", style=discord.ButtonStyle.primary)
    async def start_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                "Only the stake creator can start the session.", ephemeral=True
            )
            return
        if not self.joined:
            await interaction.response.send_message(
                "At least one person must join before you can start.", ephemeral=True
            )
            return
        self.started = True
        for child in self.children:
            child.disabled = True
        await interaction.response.edit_message(view=self)
        self.stop()

    async def on_timeout(self) -> None:
        for child in self.children:
            child.disabled = True
        self.stop()


class OpenStakeSessionView(discord.ui.View):
    def __init__(
        self,
        cog: "General",
        author_id: int,
        stake_id: int,
        token: str,
        max_recipients: int,
        duration_seconds: int,
        start_url: str,
        initial_recipients: Optional[dict[int, discord.abc.User]] = None,
    ) -> None:
        super().__init__(timeout=float(duration_seconds))
        self.cog = cog
        self.author_id = author_id
        self.stake_id = stake_id
        self.token = token
        self.max_recipients = max_recipients
        self.start_url = start_url
        self.joined_recipients: dict[int, discord.abc.User] = dict(initial_recipients or {})

    def _details_text(self) -> str:
        recipient_mentions = (
            ", ".join(user.mention for user in self.joined_recipients.values())
            if self.joined_recipients
            else "none yet"
        )
        return (
            "Anyone can join while the session timer is running.\n"
            f"Open slots: **{len(self.joined_recipients)}/{self.max_recipients}**\n"
            f"Recipients: {recipient_mentions}"
        )

    @discord.ui.button(label="Open Snitch & Start Session", style=discord.ButtonStyle.primary)
    async def open_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                "Only the stake creator can start the session.", ephemeral=True
            )
            return
        button.disabled = True
        await interaction.response.edit_message(view=self)
        await interaction.followup.send(self.start_url, ephemeral=True)

    @discord.ui.button(label="Join As Recipient", style=discord.ButtonStyle.success)
    async def join_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        if interaction.user.bot:
            await interaction.response.send_message("Bots cannot join as recipients.", ephemeral=True)
            return
        if interaction.user.id == self.author_id:
            await interaction.response.send_message("The stake creator cannot join as a recipient.", ephemeral=True)
            return
        if interaction.user.id in self.joined_recipients:
            await interaction.response.send_message("You already joined this stake.", ephemeral=True)
            return
        if len(self.joined_recipients) >= self.max_recipients:
            await interaction.response.send_message("Recipient limit reached for this stake.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True, thinking=True)

        status_ok, status_msg, status = await self.cog.auth_client.get_discord_account_status(interaction.user.id)
        if not status_ok or status is None:
            await interaction.followup.send(f"Could not verify your Snitch account: {status_msg}", ephemeral=True)
            return
        if not status.get("exists"):
            signup_url = self.cog.auth_client.signup_url_with_discord_uid(interaction.user.id)
            await interaction.followup.send(
                f"You need a Snitch account to join as a recipient.\nSign up here: {signup_url}",
                ephemeral=True,
            )
            return
        if not status.get("payout_ready"):
            await interaction.followup.send(
                f"You need to complete Stripe Connect onboarding before joining as a recipient.\n"
                f"Set it up here: {self.cog.auth_client.frontend_payment_setup_url}",
                ephemeral=True,
            )
            return

        added, message = await self.cog._add_stake_recipient_via_api(
            token=self.token,
            stake_id=self.stake_id,
            recipient_discord_uid=interaction.user.id,
        )
        if not added:
            await interaction.followup.send(
                f"Could not add you as a stake recipient.\nDetails: {message}",
                ephemeral=True,
            )
            return

        self.joined_recipients[interaction.user.id] = interaction.user
        await interaction.followup.send("You've joined the stake as a recipient!", ephemeral=True)
        await interaction.message.edit(embed=make_snitch_embed(self._details_text()), view=self)

    async def on_timeout(self) -> None:
        for child in self.children:
            child.disabled = True
        self.stop()


class General(commands.Cog, name="general"):
    def __init__(self, bot) -> None:
        self.bot = bot
        backend_base = os.getenv("BACKEND_API_BASE_URL", "http://localhost:8000/api")
        self.backend_api_base = backend_base.rstrip("/")
        self.auth_client = AuthClient()
        self.frontend_payment_setup_url = os.getenv("FRONTEND_PAYMENT_SETUP_URL", "http://localhost:5173")
        self.frontend_stake_launch_url = os.getenv("FRONTEND_STAKE_LAUNCH_URL", "http://localhost:5173")

    async def _create_stake_via_api(
        self,
        token: str,
        amount_cents: int,
        duration_seconds: int,
        recipient_discord_uids: list[int],
    ) -> tuple[bool, str, Optional[int]]:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        body = {
            "amount_cents": amount_cents,
            "duration_seconds": duration_seconds,
            "recipient_discord_uids": recipient_discord_uids,
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.backend_api_base}/stakes",
                json=body,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as response:
                if response.status != 201:
                    detail = await response.text()
                    return False, f"Stake creation failed ({response.status}): {detail[:300]}", None

                payload: Any = await response.json()
                stake_id = payload.get("id") if isinstance(payload, dict) else None
                if stake_id is None:
                    return True, "Stake created successfully.", None
                return True, f"Stake #{stake_id} created successfully.", int(stake_id)

    async def _add_stake_recipient_via_api(
        self,
        token: str,
        stake_id: int,
        recipient_discord_uid: int,
    ) -> tuple[bool, str]:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        body = {"recipient_discord_uid": recipient_discord_uid}

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.backend_api_base}/stakes/{stake_id}/recipients",
                headers=headers,
                json=body,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as response:
                if response.status not in {200, 201}:
                    detail = await response.text()
                    return False, f"Add recipient failed ({response.status}): {detail[:300]}"
                return True, ""

    async def _get_stake_via_api(
        self,
        token: str,
        stake_id: int,
    ) -> tuple[bool, str, Optional[dict[str, Any]]]:
        headers = {"Authorization": f"Bearer {token}"}
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.backend_api_base}/stakes/{stake_id}",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as response:
                if response.status != 200:
                    detail = await response.text()
                    return False, f"Fetch stake failed ({response.status}): {detail[:300]}", None
                payload: Any = await response.json()
                if not isinstance(payload, dict):
                    return False, "Could not parse stake response payload.", None
                return True, "", payload

    def _parse_backend_datetime(self, raw: Optional[str]) -> Optional[datetime]:
        if not raw:
            return None
        try:
            normalized = raw.replace("Z", "+00:00")
            dt = datetime.fromisoformat(normalized)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt.astimezone(UTC)
        except ValueError:
            return None

    def _stake_live_description(
        self,
        stake_payload: dict[str, Any],
        seconds_left: int,
    ) -> str:
        creator_username = str(stake_payload.get("creator_username") or "unknown")
        amount_cents = int(stake_payload.get("amount_cents") or 0)
        status = str(stake_payload.get("status") or "unknown")
        distraction_count = int(stake_payload.get("distraction_count") or 0)
        recipients_raw = stake_payload.get("recipients")
        recipient_names: list[str] = []
        if isinstance(recipients_raw, list):
            for recipient in recipients_raw:
                if isinstance(recipient, dict):
                    username = recipient.get("recipient_username")
                    if username:
                        recipient_names.append(str(username))
        recipients_text = ", ".join(recipient_names) if recipient_names else "none"
        return (
            f"Stake #{stake_payload.get('id', 'unknown')} is running.\n"
            f"Status: **{status}**\n"
            f"Owner: **{creator_username}**\n"
            f"Bet: **${amount_cents / 100:.2f}**\n"
            f"Recipients: {recipients_text}\n"
            f"Strikes: **{distraction_count}**\n"
            f"Time left: **{format_duration(max(0, seconds_left))}**"
        )

    async def _stream_stake_events(
        self,
        token: str,
        stake_id: int,
        queue: asyncio.Queue[dict[str, Any]],
    ) -> None:
        headers = {"Authorization": f"Bearer {token}"}
        timeout = aiohttp.ClientTimeout(total=None, sock_read=None)
        while True:
            try:
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.get(
                        f"{self.backend_api_base}/stakes/{stake_id}/events",
                        headers=headers,
                    ) as response:
                        if response.status != 200:
                            await asyncio.sleep(2)
                            continue
                        while True:
                            raw_line = await response.content.readline()
                            if raw_line == b"":
                                break
                            line = raw_line.decode("utf-8", errors="ignore").strip()
                            if not line.startswith("data: "):
                                continue
                            raw_payload = line[6:]
                            try:
                                payload = json.loads(raw_payload)
                            except json.JSONDecodeError:
                                continue
                            if isinstance(payload, dict):
                                await queue.put(payload)
            except asyncio.CancelledError:
                raise
            except aiohttp.ClientError:
                await asyncio.sleep(2)
            except Exception:
                await asyncio.sleep(2)

    async def _run_live_stake_message(
        self,
        message: discord.Message,
        token: str,
        stake_id: int,
        fallback_duration_seconds: int,
        live_view: Optional[discord.ui.View] = None,
    ) -> None:
        stake_payload: Optional[dict[str, Any]] = None
        activation_time: Optional[datetime] = None
        duration_seconds = fallback_duration_seconds
        event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        event_task = asyncio.create_task(self._stream_stake_events(token, stake_id, event_queue))

        try:
            ok, fetch_message, payload = await self._get_stake_via_api(token=token, stake_id=stake_id)
            if not ok or payload is None:
                await message.edit(
                    embed=make_snitch_embed(
                        f"Live update paused: {fetch_message}\n"
                        "Session may still be running in Snitch.",
                        is_error=True,
                    ),
                    view=live_view,
                )
                return
            stake_payload = payload
            duration_seconds = int(stake_payload.get("duration_seconds") or duration_seconds)
            activation_time = self._parse_backend_datetime(stake_payload.get("activated_at"))

            while True:
                while not event_queue.empty():
                    payload = await event_queue.get()
                    stake_payload = payload
                    duration_seconds = int(stake_payload.get("duration_seconds") or duration_seconds)
                    activation_time = self._parse_backend_datetime(stake_payload.get("activated_at"))

                if stake_payload is None:
                    await asyncio.sleep(1)
                    continue

                status = str(stake_payload.get("status") or "unknown")
                if status in {"completed", "failed", "paid_out", "cancelled"}:
                    final_embed = make_snitch_embed(
                        self._stake_live_description(stake_payload=stake_payload, seconds_left=0)
                    )
                    if live_view is not None:
                        for child in live_view.children:
                            child.disabled = True
                        live_view.stop()
                    await message.edit(embed=final_embed, view=live_view)
                    return

                if status != "active" or activation_time is None:
                    await message.edit(
                        embed=make_snitch_embed(
                            "Stake created. Waiting for session start from Snitch...\n"
                            f"Owner: **{stake_payload.get('creator_username', 'unknown')}**\n"
                            f"Bet: **${int(stake_payload.get('amount_cents') or 0) / 100:.2f}**"
                        ),
                        view=live_view,
                    )
                    await asyncio.sleep(1)
                    continue

                end_time = activation_time + timedelta(seconds=duration_seconds)
                seconds_left = int((end_time - datetime.now(UTC)).total_seconds())
                await message.edit(
                    embed=make_snitch_embed(
                        self._stake_live_description(stake_payload=stake_payload, seconds_left=seconds_left)
                    ),
                    view=live_view,
                )
                if seconds_left <= 0:
                    return
                await asyncio.sleep(1)
        finally:
            event_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await event_task

    async def _create_stake_launch_token_via_api(
        self,
        token: str,
        stake_id: int,
    ) -> tuple[bool, str, Optional[str]]:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        body = {"stake_id": stake_id}

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.backend_api_base}/auth/stake-launch-token",
                json=body,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as response:
                if response.status != 200:
                    detail = await response.text()
                    return False, f"Launch token request failed ({response.status}): {detail[:300]}", None
                payload: Any = await response.json()
                launch_token = payload.get("launch_token") if isinstance(payload, dict) else None
                if not launch_token:
                    return False, "Launch token response did not include launch_token.", None
                return True, "", str(launch_token)

    def _build_stake_launch_url(self, stake_id: int, launch_token: str) -> str:
        split = urlsplit(self.frontend_stake_launch_url)
        query = dict(parse_qsl(split.query, keep_blank_values=True))
        query["stake_id"] = str(stake_id)
        query["auto_start"] = "1"
        query["launch_token"] = launch_token
        return urlunsplit((split.scheme, split.netloc, split.path, urlencode(query), split.fragment))

    def _build_auth_view(self, discord_uid: int, status: Optional[dict[str, Any]]) -> Optional[discord.ui.View]:
        exists = bool((status or {}).get("exists"))
        payment_ready = bool((status or {}).get("payment_method_ready"))

        signup_url = self.auth_client.signup_url_with_discord_uid(discord_uid) if not exists else None
        payment_url = self.frontend_payment_setup_url if exists and not payment_ready else None
        if not signup_url and not payment_url:
            return None
        return AuthActionView(signup_url=signup_url, payment_url=payment_url)

    async def _prompt_for_text(
        self,
        context: Context,
        prompt_message: discord.Message,
        prompt: str,
        timeout: int = 120,
        delete_user_reply: bool = False,
    ) -> Optional[str]:
        await prompt_message.edit(embed=make_snitch_embed(prompt), view=None)

        def check(message: discord.Message) -> bool:
            return (
                message.author.id == context.author.id
                and message.channel.id == context.channel.id
            )

        try:
            message = await self.bot.wait_for("message", timeout=timeout, check=check)
            content = message.content
            if delete_user_reply:
                try:
                    await message.delete()
                except (discord.Forbidden, discord.HTTPException):
                    pass
            return content
        except asyncio.TimeoutError:
            await prompt_message.edit(
                embed=make_snitch_embed(
                    "Timed out waiting for input. Please run the command again.",
                    is_error=True,
                ),
                view=None,
            )
            return None

    @commands.hybrid_command(
        name="stake",
        description="Create a stake session and invite recipients.",
    )
    async def stake(self, context: Context) -> None:
        if context.guild is None:
            await context.send(embed=make_snitch_embed("This command can only be used in a server.", is_error=True))
            return

        initial_message = await context.send(
            embed=make_snitch_embed("Checking your Snitch account..."),
            view=None,
        )
        auth_ok, auth_message, token, status = await self.auth_client.authenticate_discord_user(
            context.author.id,
            require_payment_method=True,
        )
        if not auth_ok or token is None:
            auth_view = self._build_auth_view(context.author.id, status)
            await initial_message.edit(
                embed=make_snitch_embed(auth_message or "Could not authenticate with backend.", is_error=True),
                view=auth_view,
            )
            return

        prompt_message = initial_message
        recipient_mode_view = RecipientModeView(context.author.id)
        await prompt_message.edit(
            embed=make_snitch_embed(
                "Choose recipient mode:\n"
                "- **Mention Recipients**: lock recipients before stake starts.\n"
                "- **Anyone Can Join**: allow members to join while timer is running."
            ),
            view=recipient_mode_view,
        )
        await recipient_mode_view.wait()
        if recipient_mode_view.mode is None:
            await prompt_message.edit(
                embed=make_snitch_embed("No recipient mode selected in time. Command canceled.", is_error=True),
                view=None,
            )
            return

        recipients: list[discord.abc.User] = []
        max_recipients: Optional[int] = None
        if recipient_mode_view.mode == "mention":
            await prompt_message.edit(
                embed=make_snitch_embed("Mention all recipients in one message (for example: `@user1 @user2`)."),
                view=None,
            )

            def mention_check(message: discord.Message) -> bool:
                return (
                    message.author.id == context.author.id
                    and message.channel.id == context.channel.id
                )

            try:
                mention_message = await self.bot.wait_for(
                    "message", timeout=180, check=mention_check
                )
            except asyncio.TimeoutError:
                await prompt_message.edit(
                    embed=make_snitch_embed(
                        "Timed out waiting for mentions. Please run the command again.",
                        is_error=True,
                    ),
                    view=None,
                )
                return

            seen_ids: set[int] = set()
            for member in mention_message.mentions:
                if member.bot or member.id == context.author.id or member.id in seen_ids:
                    continue
                seen_ids.add(member.id)
                recipients.append(member)

            if not recipients:
                await prompt_message.edit(
                    embed=make_snitch_embed("You must mention at least one valid recipient.", is_error=True),
                    view=None,
                )
                return
        else:
            for _ in range(3):
                raw_max = await self._prompt_for_text(
                    context,
                    prompt_message,
                    "Enter the **maximum number of recipients** allowed to join (1-25).",
                    delete_user_reply=True,
                )
                if raw_max is None:
                    return
                if raw_max.strip().isdigit():
                    value = int(raw_max.strip())
                    if 1 <= value <= 25:
                        max_recipients = value
                        break
                await prompt_message.edit(
                    embed=make_snitch_embed(
                        "Invalid max recipient value. Enter a whole number between 1 and 25.",
                        is_error=True,
                    ),
                    view=None,
                )

            if max_recipients is None:
                await prompt_message.edit(
                    embed=make_snitch_embed("Too many invalid max-recipient attempts. Command canceled.", is_error=True),
                    view=None,
                )
                return

        bet_amount: Optional[float] = None
        for _ in range(3):
            raw_bet = await self._prompt_for_text(
                context,
                prompt_message,
                "Enter the amount of money to bet (example: `$25` or `25.50`).",
                delete_user_reply=True,
            )
            if raw_bet is None:
                return
            bet_amount = parse_money_amount(raw_bet)
            if bet_amount is not None:
                break
            await prompt_message.edit(
                embed=make_snitch_embed(
                    "That amount is invalid. Try again with a positive number.\n"
                    "Enter the amount of money to bet (example: `$25` or `25.50`).",
                    is_error=True,
                ),
                view=None,
            )

        if bet_amount is None:
            await prompt_message.edit(
                embed=make_snitch_embed("Too many invalid amount attempts. Command canceled.", is_error=True),
                view=None,
            )
            return

        duration_seconds: Optional[int] = None
        for _ in range(3):
            raw_duration = await self._prompt_for_text(
                context,
                prompt_message,
                "Enter a time amount (example: `45s`, `10m`, `1h`, or `15` for 15 minutes).",
                delete_user_reply=True,
            )
            if raw_duration is None:
                return
            duration_seconds = parse_duration_seconds(raw_duration)
            if duration_seconds is not None:
                break
            await prompt_message.edit(
                embed=make_snitch_embed(
                    "That time format is invalid. Try again.\n"
                    "Enter a time amount (example: `45s`, `10m`, `1h`, or `15` for 15 minutes).",
                    is_error=True,
                ),
                view=None,
            )

        if duration_seconds is None:
            await prompt_message.edit(
                embed=make_snitch_embed("Too many invalid time attempts. Command canceled.", is_error=True),
                view=None,
            )
            return

        # In open-join mode, show a lobby and wait for at least one joiner before creating the stake.
        if recipient_mode_view.mode == "anyone":
            lobby_view = LobbyView(
                author_id=context.author.id,
                max_recipients=max_recipients or 1,
                amount=bet_amount,
                duration_seconds=duration_seconds,
                auth_client=self.auth_client,
            )
            await prompt_message.edit(embed=make_snitch_embed(lobby_view._details_text()), view=lobby_view)
            await lobby_view.wait()

            if not lobby_view.started:
                await prompt_message.edit(
                    embed=make_snitch_embed("Lobby timed out with no one ready. Command canceled.", is_error=True),
                    view=None,
                )
                return

            recipients = list(lobby_view.joined.values())

        recipient_discord_uids = sorted({user.id for user in recipients if user.id > 0})

        amount_cents = int(round(bet_amount * 100))
        await prompt_message.edit(
            embed=make_snitch_embed(
                f"Creating stake via API...\n"
                f"Amount: ${bet_amount:.2f}\n"
                f"Recipient mode: {recipient_mode_view.mode}\n"
                f"Duration: {format_duration(duration_seconds)}\n"
                f"Recipients: {', '.join(user.mention for user in recipients) if recipients else 'none yet'}"
            ),
            view=None,
        )
        created, creation_message, stake_id = await self._create_stake_via_api(
            token=token,
            amount_cents=amount_cents,
            duration_seconds=duration_seconds,
            recipient_discord_uids=recipient_discord_uids,
        )
        if not created:
            await prompt_message.edit(
                embed=make_snitch_embed(creation_message, is_error=True),
                view=None,
            )
            return

        await prompt_message.edit(
            embed=make_snitch_embed(creation_message),
            view=None,
        )
        if stake_id is None:
            await prompt_message.edit(
                embed=make_snitch_embed(
                    "Stake created, but no stake ID was returned by backend. Cannot continue.",
                    is_error=True,
                ),
                view=None,
            )
            return

        launch_ok, launch_message, launch_token = await self._create_stake_launch_token_via_api(
            token=token,
            stake_id=stake_id,
        )
        if not launch_ok or launch_token is None:
            await prompt_message.edit(
                embed=make_snitch_embed(launch_message or "Could not create secure launch token.", is_error=True),
                view=None,
            )
            return
        start_url = self._build_stake_launch_url(stake_id=stake_id, launch_token=launch_token)
        if recipient_mode_view.mode == "mention":
            mention_text = " ".join(user.mention for user in recipients)
            start_view = StartStakeView(start_url=start_url, author_id=context.author.id)
            await prompt_message.edit(
                embed=make_snitch_embed(
                    "Stake is ready.\n"
                    "Recipients are locked because you chose mention mode.\n"
                    f"Recipients: {mention_text}\n"
                    "Use the button below to open Snitch, sign in with Discord, and auto-start the session."
                ),
                view=start_view,
            )
            await self._run_live_stake_message(
                message=prompt_message,
                token=token,
                stake_id=stake_id,
                fallback_duration_seconds=duration_seconds,
                live_view=start_view,
            )
            return

        open_join_view = OpenStakeSessionView(
            cog=self,
            author_id=context.author.id,
            stake_id=stake_id,
            token=token,
            max_recipients=max_recipients or 1,
            duration_seconds=duration_seconds,
            start_url=start_url,
            initial_recipients={u.id: u for u in recipients},
        )
        await prompt_message.edit(
            embed=make_snitch_embed(
                "Stake is ready in open mode.\n"
                "Members can join as recipients until the timer window ends.\n"
                "Use the button below to open Snitch, sign in with Discord, and auto-start the session."
            ),
            view=open_join_view,
        )
        await self._run_live_stake_message(
            message=prompt_message,
            token=token,
            stake_id=stake_id,
            fallback_duration_seconds=duration_seconds,
            live_view=open_join_view,
        )

    


async def setup(bot) -> None:
    await bot.add_cog(General(bot))
