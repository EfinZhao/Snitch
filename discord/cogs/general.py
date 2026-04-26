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
    cleaned = raw.strip().replace('$', '').replace(',', '')
    try:
        value = float(cleaned)
    except ValueError:
        return None
    if value <= 0:
        return None
    return round(value, 2)


def parse_duration_seconds(raw: str) -> Optional[int]:
    text = raw.strip().lower().replace(' ', '')
    if not text:
        return None

    if text.isdigit():
        # Plain numbers are interpreted as minutes.
        minutes = int(text)
        return minutes * 60 if minutes > 0 else None

    match = re.fullmatch(r'(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?', text)
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
        parts.append(f'{hours}h')
    if minutes:
        parts.append(f'{minutes}m')
    if secs or not parts:
        parts.append(f'{secs}s')
    return ' '.join(parts)


def make_snitch_embed(description: str, is_error: bool = False, title: str = 'Session') -> discord.Embed:
    color = 0xE02B2B if is_error else 0x2F80ED
    return discord.Embed(title=title, description=description, color=color)


class RecipientModeView(discord.ui.View):
    def __init__(self, author_id: int) -> None:
        super().__init__(timeout=120)
        self.author_id = author_id
        self.mode: Optional[str] = None

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message('Only the person who ran `/session` can choose this.', ephemeral=True)
            return False
        return True

    @discord.ui.button(label='Tag Them Now', style=discord.ButtonStyle.primary)
    async def mention_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        self.mode = 'mention'
        for child in self.children:
            child.disabled = True
        await interaction.response.edit_message(embed=make_snitch_embed('Doubters: **Tagged**'), view=self)
        self.stop()

    @discord.ui.button(label='Open to Anyone', style=discord.ButtonStyle.success)
    async def anyone_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        self.mode = 'anyone'
        for child in self.children:
            child.disabled = True
        await interaction.response.edit_message(embed=make_snitch_embed('Doubters: **Open**'), view=self)
        self.stop()


class AuthActionView(discord.ui.View):
    def __init__(self, signup_url: Optional[str], payment_url: Optional[str]) -> None:
        super().__init__(timeout=300)
        if signup_url:
            self.add_item(
                discord.ui.Button(
                    label='Create & Link Snitch Account',
                    style=discord.ButtonStyle.link,
                    url=signup_url,
                )
            )
        if payment_url:
            self.add_item(
                discord.ui.Button(
                    label='Set Up Payment Method',
                    style=discord.ButtonStyle.link,
                    url=payment_url,
                )
            )


class StartSessionView(discord.ui.View):
    def __init__(self, start_url: str, author_id: int) -> None:
        super().__init__(timeout=3600)
        self.start_url = start_url
        self.author_id = author_id

    @discord.ui.button(label='Start My Session', style=discord.ButtonStyle.primary)
    async def open_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                'Only the person running this session can start it.', ephemeral=True
            )
            return
        button.disabled = True
        await interaction.response.edit_message(view=self)
        await interaction.followup.send(self.start_url, ephemeral=True)


class LobbyView(discord.ui.View):
    def __init__(
        self, author_id: int, max_recipients: int, amount: float, duration_seconds: int, auth_client: 'AuthClient'
    ) -> None:
        super().__init__(timeout=300)
        self.author_id = author_id
        self.max_recipients = max_recipients
        self.amount = amount
        self.duration_seconds = duration_seconds
        self.auth_client = auth_client
        self.joined: dict[int, discord.abc.User] = {}
        self.started = False

    def _details_text(self) -> str:
        recipient_mentions = ', '.join(u.mention for u in self.joined.values()) if self.joined else 'none yet'
        return (
            f'**Lobby is open** — waiting for doubters.\n'
            f'Bet: **${self.amount:.2f}** | Duration: **{format_duration(self.duration_seconds)}**\n'
            f'Doubters ({len(self.joined)}/{self.max_recipients}): {recipient_mentions}\n\n'
            'Once at least one doubter joins, hit **Start My Session**.'
        )

    @discord.ui.button(label="I'm a Doubter", style=discord.ButtonStyle.success)
    async def join_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        user = interaction.user
        if user.bot or user.id == self.author_id:
            await interaction.response.send_message("You can't doubt your own session.", ephemeral=True)
            return
        if user.id in self.joined:
            await interaction.response.send_message("You're already a doubter here!", ephemeral=True)
            return
        if len(self.joined) >= self.max_recipients:
            await interaction.response.send_message('No more room — the doubter slots are full.', ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True, thinking=True)

        status_ok, status_msg, status = await self.auth_client.get_discord_account_status(user.id)
        if not status_ok or status is None:
            await interaction.followup.send(f'Could not verify your Snitch account: {status_msg}', ephemeral=True)
            return
        if not status.get('exists'):
            signup_url = self.auth_client.signup_url_with_discord_uid(user.id)
            await interaction.followup.send(
                f"You'll need a Snitch account first.\nSign up here: {signup_url}",
                ephemeral=True,
            )
            return
        if not status.get('payout_ready'):
            await interaction.followup.send(
                f"You'll need to set up payouts before you can doubt someone.\n"
                f'Get set up here: {self.auth_client.frontend_payment_setup_url}',
                ephemeral=True,
            )
            return

        self.joined[user.id] = user
        await interaction.followup.send("You're in as a doubter!", ephemeral=True)
        await interaction.message.edit(embed=make_snitch_embed(self._details_text()), view=self)

    @discord.ui.button(label='Start My Session', style=discord.ButtonStyle.primary)
    async def start_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                'Only the person running this session can start it.', ephemeral=True
            )
            return
        if not self.joined:
            await interaction.response.send_message(
                'You need at least one doubter before you can start.', ephemeral=True
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


class OpenSessionSessionView(discord.ui.View):
    def __init__(
        self,
        cog: 'General',
        author_id: int,
        session_id: int,
        token: str,
        max_recipients: int,
        duration_seconds: int,
        start_url: str,
        initial_recipients: Optional[dict[int, discord.abc.User]] = None,
    ) -> None:
        super().__init__(timeout=float(duration_seconds))
        self.cog = cog
        self.author_id = author_id
        self.session_id = session_id
        self.token = token
        self.max_recipients = max_recipients
        self.start_url = start_url
        self.joined_recipients: dict[int, discord.abc.User] = dict(initial_recipients or {})

    def _details_text(self) -> str:
        recipient_mentions = (
            ', '.join(user.mention for user in self.joined_recipients.values())
            if self.joined_recipients
            else 'none yet'
        )
        return (
            'Anyone can join as a doubter while the session is live.\n'
            f'Doubters ({len(self.joined_recipients)}/{self.max_recipients}): {recipient_mentions}'
        )

    @discord.ui.button(label='Start My Session', style=discord.ButtonStyle.primary)
    async def open_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                'Only the person running this session can start it.', ephemeral=True
            )
            return
        button.disabled = True
        await interaction.response.edit_message(view=self)
        await interaction.followup.send(self.start_url, ephemeral=True)

    @discord.ui.button(label="I'm a Doubter", style=discord.ButtonStyle.success)
    async def join_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if interaction.user.bot:
            await interaction.response.send_message("Bots can't be doubters.", ephemeral=True)
            return
        if interaction.user.id == self.author_id:
            await interaction.response.send_message("You can't doubt your own session!", ephemeral=True)
            return
        if interaction.user.id in self.joined_recipients:
            await interaction.response.send_message("You're already a doubter on this one!", ephemeral=True)
            return
        if len(self.joined_recipients) >= self.max_recipients:
            await interaction.response.send_message('This session is fully doubted — no room left.', ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True, thinking=True)

        status_ok, status_msg, status = await self.cog.auth_client.get_discord_account_status(interaction.user.id)
        if not status_ok or status is None:
            await interaction.followup.send("Couldn't verify your Snitch account. Try again later.", ephemeral=True)
            return
        if not status.get('exists'):
            signup_url = self.cog.auth_client.signup_url_with_discord_uid(interaction.user.id)
            await interaction.followup.send(
                f"You'll need a Snitch account first.\nSign up here: {signup_url}",
                ephemeral=True,
            )
            return
        if not status.get('payout_ready'):
            await interaction.followup.send(
                f"You'll need to set up payouts before you can doubt someone.\n"
                f'Get set up here: {self.cog.auth_client.frontend_payment_setup_url}',
                ephemeral=True,
            )
            return

        added, message = await self.cog._add_session_recipient_via_api(
            token=self.token,
            session_id=self.session_id,
            recipient_discord_uid=interaction.user.id,
        )
        if not added:
            await interaction.followup.send(
                f'Something went wrong adding you as a doubter.\nDetails: {message}',
                ephemeral=True,
            )
            return

        self.joined_recipients[interaction.user.id] = interaction.user
        await interaction.followup.send("You're in as a doubter — good luck to them 😈", ephemeral=True)
        await interaction.message.edit(embed=make_snitch_embed(self._details_text()), view=self)

    async def on_timeout(self) -> None:
        for child in self.children:
            child.disabled = True
        self.stop()


class General(commands.Cog, name='general'):
    def __init__(self, bot) -> None:
        self.bot = bot
        backend_base = os.getenv('BACKEND_API_BASE_URL', 'http://localhost:8000/api')
        self.backend_api_base = backend_base.rstrip('/')
        self.auth_client = AuthClient()
        self.frontend_payment_setup_url = os.getenv("FRONTEND_PAYMENT_SETUP_URL", "http://localhost:5173")
        self.frontend_session_launch_url = os.getenv("FRONTEND_SESSION_LAUNCH_URL", "http://localhost:5173")

    async def _create_session_via_api(
        self,
        token: str,
        amount_cents: int,
        duration_seconds: int,
        recipient_discord_uids: list[int],
    ) -> tuple[bool, str, Optional[int]]:
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        }
        body = {
            'amount_cents': amount_cents,
            'duration_seconds': duration_seconds,
            'recipient_discord_uids': recipient_discord_uids,
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.backend_api_base}/sessions",
                json=body,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as response:
                if response.status != 201:
                    detail = await response.text()
                    return False, f"Session creation failed ({response.status}): {detail[:300]}", None

                payload: Any = await response.json()
                session_id = payload.get("id") if isinstance(payload, dict) else None
                if session_id is None:
                    return True, "Session created successfully, loading...", None
                return True, f"Session created successfully, loading...", int(session_id)

    async def _add_session_recipient_via_api(
        self,
        token: str,
        session_id: int,
        recipient_discord_uid: int,
    ) -> tuple[bool, str]:
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        }
        body = {'recipient_discord_uid': recipient_discord_uid}

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.backend_api_base}/sessions/{session_id}/recipients",
                headers=headers,
                json=body,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as response:
                if response.status not in {200, 201}:
                    detail = await response.text()
                    return False, f'Add doubter failed ({response.status}): {detail[:300]}'
                return True, ''

    async def _get_session_via_api(
        self,
        token: str,
        session_id: int,
    ) -> tuple[bool, str, Optional[dict[str, Any]]]:
        headers = {'Authorization': f'Bearer {token}'}
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.backend_api_base}/sessions/{session_id}",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as response:
                if response.status != 200:
                    detail = await response.text()
                    return False, f"Fetch session failed ({response.status}): {detail[:300]}", None
                payload: Any = await response.json()
                if not isinstance(payload, dict):
                    return False, "Could not parse session response payload.", None
                return True, "", payload

    def _parse_backend_datetime(self, raw: Optional[str]) -> Optional[datetime]:
        if not raw:
            return None
        try:
            normalized = raw.replace('Z', '+00:00')
            dt = datetime.fromisoformat(normalized)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt.astimezone(UTC)
        except ValueError:
            return None

    @staticmethod
    def _extract_recipient_names(session_payload: dict[str, Any]) -> list[str]:
        names: list[str] = []
        for r in session_payload.get('recipients') or []:
            if isinstance(r, dict):
                u = r.get('recipient_username')
                if u:
                    names.append(str(u))
        return names

    def _session_live_description(
        self,
        session_payload: dict[str, Any],
        seconds_left: int,
    ) -> str:
        amount_cents = int(session_payload.get('amount_cents') or 0)
        distraction_count = int(session_payload.get('distraction_count') or 0)
        doubters_text = ', '.join(self._extract_recipient_names(session_payload)) or 'none'
        return (
            f'Bet: **${amount_cents / 100:.2f}**\n'
            f'Doubters: {doubters_text}\n'
            f'Strikes: **{distraction_count}**\n'
            f'Time left: **{format_duration(max(0, seconds_left))}**'
        )

    def _session_final_summary(self, session_payload: dict[str, Any]) -> str:
        status = str(session_payload.get('status') or 'unknown')
        amount_cents = int(session_payload.get('amount_cents') or 0)
        distraction_count = int(session_payload.get('distraction_count') or 0)
        elapsed = int(session_payload.get('elapsed_seconds') or 0)
        doubters_text = ', '.join(self._extract_recipient_names(session_payload)) or 'none'
        outcome = '✅ Completed' if status == 'completed' else '❌ Failed'
        return (
            f'{outcome}\n'
            f'Bet: **${amount_cents / 100:.2f}**\n'
            f'Duration: **{format_duration(elapsed)}**\n'
            f'Strikes: **{distraction_count}**\n'
            f'Doubters: {doubters_text}'
        )

    async def _stream_session_events(
        self,
        token: str,
        session_id: int,
        queue: asyncio.Queue[dict[str, Any]],
    ) -> None:
        headers = {'Authorization': f'Bearer {token}'}
        timeout = aiohttp.ClientTimeout(total=None, sock_read=None)
        while True:
            try:
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.get(
                        f"{self.backend_api_base}/sessions/{session_id}/events",
                        headers=headers,
                    ) as response:
                        if response.status != 200:
                            await asyncio.sleep(2)
                            continue
                        while True:
                            raw_line = await response.content.readline()
                            if raw_line == b'':
                                break
                            line = raw_line.decode('utf-8', errors='ignore').strip()
                            if not line.startswith('data: '):
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

    async def _run_live_session_message(
        self,
        message: discord.Message,
        token: str,
        session_id: int,
        fallback_duration_seconds: int,
        session_title: str = 'Study Session',
        live_view: Optional[discord.ui.View] = None,
    ) -> None:
        session_payload: Optional[dict[str, Any]] = None
        activation_time: Optional[datetime] = None
        duration_seconds = fallback_duration_seconds
        resolving_since: Optional[datetime] = None
        event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        event_task = asyncio.create_task(self._stream_session_events(token, session_id, event_queue))

        try:
            ok, fetch_message, payload = await self._get_session_via_api(token=token, session_id=session_id)
            if not ok or payload is None:
                await message.edit(
                    embed=make_snitch_embed(
                        f'Live update paused: {fetch_message}\nSession may still be running in Snitch.',
                        is_error=True,
                    ),
                    view=live_view,
                )
                return
            session_payload = payload
            duration_seconds = int(session_payload.get("duration_seconds") or duration_seconds)
            activation_time = self._parse_backend_datetime(session_payload.get("activated_at"))

            while True:
                while not event_queue.empty():
                    payload = await event_queue.get()
                    session_payload = payload
                    duration_seconds = int(session_payload.get("duration_seconds") or duration_seconds)
                    activation_time = self._parse_backend_datetime(session_payload.get("activated_at"))

                if session_payload is None:
                    await asyncio.sleep(1)
                    continue

                status = str(session_payload.get("status") or "unknown")
                if status in {"completed", "failed", "paid_out", "cancelled"}:
                    if live_view is not None:
                        for child in live_view.children:
                            child.disabled = True
                        live_view.stop()
                    await message.edit(
                        embed=make_snitch_embed(
                            self._session_final_summary(session_payload),
                            title=session_title,
                        ),
                        view=live_view,
                    )
                    return

                if status != 'active' or activation_time is None:
                    await message.edit(
                        embed=make_snitch_embed(
                            "Session created. Waiting for session start from Snitch...\n"
                            f"Owner: **{session_payload.get('creator_username', 'unknown')}**\n"
                            f"Bet: **${int(session_payload.get('amount_cents') or 0) / 100:.2f}**"
                        ),
                        view=live_view,
                    )
                    await asyncio.sleep(1)
                    continue

                end_time = activation_time + timedelta(seconds=duration_seconds)
                seconds_left = int((end_time - datetime.now(UTC)).total_seconds())

                if seconds_left <= 0:
                    # Timer expired — wait up to 60 s for the backend resolve event
                    if resolving_since is None:
                        resolving_since = datetime.now(UTC)
                        await message.edit(
                            embed=make_snitch_embed(
                                'Wrapping up your session...',
                                title=session_title,
                            ),
                            view=live_view,
                        )
                    elif (datetime.now(UTC) - resolving_since).total_seconds() > 60:
                        return
                    await asyncio.sleep(1)
                    continue

                await message.edit(
                    embed=make_snitch_embed(
                        self._session_live_description(
                            session_payload=session_payload, seconds_left=seconds_left
                        ),
                        title=session_title,
                    ),
                    view=live_view,
                )
                await asyncio.sleep(1)
        finally:
            event_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await event_task

    async def _create_session_launch_token_via_api(
        self,
        token: str,
        session_id: int,
    ) -> tuple[bool, str, Optional[str]]:
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        }
        body = {"session_id": session_id}

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.backend_api_base}/auth/session-launch-token",
                json=body,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as response:
                if response.status != 200:
                    detail = await response.text()
                    return False, f'Launch token request failed ({response.status}): {detail[:300]}', None
                payload: Any = await response.json()
                launch_token = payload.get('launch_token') if isinstance(payload, dict) else None
                if not launch_token:
                    return False, 'Launch token response did not include launch_token.', None
                return True, '', str(launch_token)

    def _build_session_launch_url(self, session_id: int, launch_token: str) -> str:
        split = urlsplit(self.frontend_session_launch_url)
        query = dict(parse_qsl(split.query, keep_blank_values=True))
        query["session_id"] = str(session_id)
        query["auto_start"] = "1"
        query["launch_token"] = launch_token
        return urlunsplit((split.scheme, split.netloc, split.path, urlencode(query), split.fragment))

    def _build_auth_view(self, discord_uid: int, status: Optional[dict[str, Any]]) -> Optional[discord.ui.View]:
        exists = bool((status or {}).get('exists'))
        payment_ready = bool((status or {}).get('payment_method_ready'))

        signup_url = self.auth_client.signup_url_with_discord_uid(discord_uid) if not exists else None
        payment_url = self.frontend_payment_setup_url if exists and not payment_ready else None
        if not signup_url and not payment_url:
            return None
        return AuthActionView(signup_url=signup_url, payment_url=payment_url)

    async def _wait_for_view_or_cancel(
        self,
        context: Context,
        prompt_message: discord.Message,
        view: discord.ui.View,
    ) -> bool:
        """Wait for a view to finish, but allow the creator to type `cancel` at any time."""

        def check(message: discord.Message) -> bool:
            return message.author.id == context.author.id and message.channel.id == context.channel.id

        view_task = asyncio.create_task(view.wait())
        try:
            while True:
                msg_task = asyncio.create_task(self.bot.wait_for('message', check=check))
                done, _ = await asyncio.wait({view_task, msg_task}, return_when=asyncio.FIRST_COMPLETED)

                if view_task in done:
                    msg_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await msg_task
                    return False

                message = msg_task.result()
                if message.content.strip().lower() != 'cancel':
                    continue

                try:
                    await message.delete()
                except (discord.Forbidden, discord.HTTPException):
                    pass

                for child in view.children:
                    child.disabled = True
                view.stop()
                await prompt_message.edit(
                    embed=make_snitch_embed('Session creation cancelled.', is_error=True),
                    view=view,
                )
                return True
        finally:
            if not view_task.done():
                view_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await view_task

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
            return message.author.id == context.author.id and message.channel.id == context.channel.id

        try:
            message = await self.bot.wait_for('message', timeout=timeout, check=check)
            content = message.content
            if delete_user_reply:
                try:
                    await message.delete()
                except (discord.Forbidden, discord.HTTPException):
                    pass
            if content.strip().lower() == 'cancel':
                await prompt_message.edit(
                    embed=make_snitch_embed('Session creation cancelled.', is_error=True),
                    view=None,
                )
                return None
            return content
        except asyncio.TimeoutError:
            await prompt_message.edit(
                embed=make_snitch_embed(
                    "Took too long. Run `/session` again when you're ready.",
                    is_error=True,
                ),
                view=None,
            )
            return None

    @commands.hybrid_command(
        name="session",
        description="Create a session session and invite doubters.",
    )
    async def session(self, context: Context) -> None:
        if context.guild is None:
            await context.send(embed=make_snitch_embed('This command can only be used in a server.', is_error=True))
            return

        initial_message = await context.send(
            embed=make_snitch_embed('Getting you set up...'),
            view=None,
        )
        auth_ok, auth_message, token, status = await self.auth_client.authenticate_discord_user(
            context.author.id,
            require_payment_method=True,
        )
        if not auth_ok or token is None:
            auth_view = self._build_auth_view(context.author.id, status)
            await initial_message.edit(
                embed=make_snitch_embed(auth_message or 'Could not authenticate with backend.', is_error=True),
                view=auth_view,
            )
            return

        prompt_message = initial_message
        recipient_mode_view = RecipientModeView(context.author.id)
        await prompt_message.edit(
            embed=make_snitch_embed(
                "Who's doubting you?\n"
                '- **Tag Them Now**: lock in your doubters before the session starts.\n'
                '- **Open to Anyone**: let people join as doubters while you study.\n\n'
                'Type `cancel` at any time before the session starts to abort creation.'
            ),
            view=recipient_mode_view,
        )
        cancelled = await self._wait_for_view_or_cancel(context, prompt_message, recipient_mode_view)
        if cancelled:
            return
        if recipient_mode_view.mode is None:
            await prompt_message.edit(
                embed=make_snitch_embed(
                    "You didn't choose in time. Run `/session` again when you're ready.", is_error=True
                ),
                view=None,
            )
            return

        recipients: list[discord.abc.User] = []
        max_recipients: Optional[int] = None
        if recipient_mode_view.mode == 'mention':
            await prompt_message.edit(
                embed=make_snitch_embed(
                    'Tag your doubters — mention them in one message (e.g. `@alice @bob`).\n'
                    'Type `cancel` to abort.\n'
                ),
                view=None,
            )

            def mention_check(message: discord.Message) -> bool:
                return message.author.id == context.author.id and message.channel.id == context.channel.id

            seen_ids: set[int] = set()
            while True:
                try:
                    mention_message = await self.bot.wait_for('message', timeout=180, check=mention_check)
                except asyncio.TimeoutError:
                    await prompt_message.edit(
                        embed=make_snitch_embed(
                            "Took too long. Run `/session` again when you've got your doubters ready.",
                            is_error=True,
                        ),
                        view=None,
                    )
                    return

                raw_input = mention_message.content.strip().lower()
                try:
                    await mention_message.delete()
                except (discord.Forbidden, discord.HTTPException):
                    pass

                if raw_input == 'cancel':
                    await prompt_message.edit(
                        embed=make_snitch_embed('Session creation cancelled.', is_error=True),
                        view=None,
                    )
                    return

                if raw_input == 'skip':
                    if recipients:
                        break
                    await prompt_message.edit(
                        embed=make_snitch_embed(
                            'You need at least one valid doubter before you can skip. Mention someone with a Snitch account.',
                            is_error=True,
                        ),
                        view=None,
                    )
                    continue

                if not mention_message.mentions:
                    await prompt_message.edit(
                        embed=make_snitch_embed(
                            'No mentions found. Mention at least one user, or type `skip` if you already added someone.',
                            is_error=True,
                        ),
                        view=None,
                    )
                    continue

                added_now: list[discord.abc.User] = []
                missing_accounts: list[str] = []
                verification_errors: list[str] = []

                for member in mention_message.mentions:
                    if member.bot or member.id == context.author.id or member.id in seen_ids:
                        continue

                    status_ok, status_msg, status = await self.auth_client.get_discord_account_status(member.id)
                    if not status_ok or status is None:
                        verification_errors.append(f'{member.mention} ({status_msg or "status check failed"})')
                        continue
                    if not bool(status.get('exists')):
                        missing_accounts.append(member.mention)
                        continue

                    seen_ids.add(member.id)
                    recipients.append(member)
                    added_now.append(member)

                if missing_accounts or verification_errors:
                    details: list[str] = []
                    if added_now:
                        details.append(f"Added: {' '.join(user.mention for user in added_now)}")
                    if missing_accounts:
                        details.append(
                            'No linked Snitch account: ' + ', '.join(missing_accounts)
                        )
                    if verification_errors:
                        details.append('Could not verify: ' + '; '.join(verification_errors))

                    skip_line = (
                        'Type `skip` to continue, or mention more users.'
                        if recipients
                        else 'Mention new users with linked Snitch accounts.'
                    )
                    await prompt_message.edit(
                        embed=make_snitch_embed(
                            '\n'.join(details + [skip_line]),
                            is_error=True,
                        ),
                        view=None,
                    )
                    continue

                if added_now:
                    break

                await prompt_message.edit(
                    embed=make_snitch_embed(
                        'No new valid doubters were added. Mention different users, or type `skip` if you already added someone.',
                        is_error=True,
                    ),
                    view=None,
                )

            if not recipients:
                await prompt_message.edit(
                    embed=make_snitch_embed('You need at least one doubter — mention someone!', is_error=True),
                    view=None,
                )
                return
        else:
            for _ in range(3):
                raw_max = await self._prompt_for_text(
                    context,
                    prompt_message,
                    'How many people can doubt you? Enter a number from 1 to 25.',
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
                        "That's not valid. Enter a whole number between 1 and 25.",
                        is_error=True,
                    ),
                    view=None,
                )

            if max_recipients is None:
                await prompt_message.edit(
                    embed=make_snitch_embed("Too many tries. Run `/session` again when you're ready.", is_error=True),
                    view=None,
                )
                return

        bet_amount: Optional[float] = None
        for _ in range(3):
            raw_bet = await self._prompt_for_text(
                context,
                prompt_message,
                'How much are you putting on the line? (e.g. `$25` or `10.50`)',
                delete_user_reply=True,
            )
            if raw_bet is None:
                return
            bet_amount = parse_money_amount(raw_bet)
            if bet_amount is not None:
                break
            await prompt_message.edit(
                embed=make_snitch_embed(
                    "That doesn't look right. Enter a dollar amount, like `$25` or `10.50`.",
                    is_error=True,
                ),
                view=None,
            )

        if bet_amount is None:
            await prompt_message.edit(
                embed=make_snitch_embed("Too many tries. Run `/session` again when you're ready.", is_error=True),
                view=None,
            )
            return

        duration_seconds: Optional[int] = None
        for _ in range(3):
            raw_duration = await self._prompt_for_text(
                context,
                prompt_message,
                'How long is your study session? (e.g. `25m`, `1h`, or `90` for 90 minutes)',
                delete_user_reply=True,
            )
            if raw_duration is None:
                return
            duration_seconds = parse_duration_seconds(raw_duration)
            if duration_seconds is not None:
                break
            await prompt_message.edit(
                embed=make_snitch_embed(
                    "Didn't quite get that. Try something like `25m`, `1h`, or `1h30m`.",
                    is_error=True,
                ),
                view=None,
            )

        if duration_seconds is None:
            await prompt_message.edit(
                embed=make_snitch_embed("Too many tries. Run `/session` again when you're ready.", is_error=True),
                view=None,
            )
            return

        # In open-join mode, show a lobby and wait for at least one joiner before creating the session.
        if recipient_mode_view.mode == 'anyone':
            lobby_view = LobbyView(
                author_id=context.author.id,
                max_recipients=max_recipients or 1,
                amount=bet_amount,
                duration_seconds=duration_seconds,
                auth_client=self.auth_client,
            )
            await prompt_message.edit(
                embed=make_snitch_embed(
                    lobby_view._details_text(), title=f"{context.author.display_name}'s Study Session"
                ),
                view=lobby_view,
            )
            cancelled = await self._wait_for_view_or_cancel(context, prompt_message, lobby_view)
            if cancelled:
                return

            if not lobby_view.started:
                await prompt_message.edit(
                    embed=make_snitch_embed(
                        'Nobody showed up. Run `/session` again when your doubters are ready.', is_error=True
                    ),
                    view=None,
                )
                return

            recipients = list(lobby_view.joined.values())

        recipient_discord_uids = sorted({user.id for user in recipients if user.id > 0})

        amount_cents = int(round(bet_amount * 100))
        await prompt_message.edit(
            embed=make_snitch_embed(
                f'Setting up your session...\n'
                f'Bet: **${bet_amount:.2f}** | Duration: **{format_duration(duration_seconds)}**\n'
                f'Doubters: {", ".join(user.mention for user in recipients) if recipients else "none yet"}',
                title=f"{context.author.display_name}'s Study Session",
            ),
            view=None,
        )
        created, creation_message, session_id = await self._create_session_via_api(
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
        if session_id is None:
            await prompt_message.edit(
                embed=make_snitch_embed(
                    "Session created, but no session ID was returned by backend. Cannot continue.",
                    is_error=True,
                ),
                view=None,
            )
            return

        launch_ok, launch_message, launch_token = await self._create_session_launch_token_via_api(
            token=token,
            session_id=session_id,
        )
        if not launch_ok or launch_token is None:
            await prompt_message.edit(
                embed=make_snitch_embed(launch_message or 'Could not create secure launch token.', is_error=True),
                view=None,
            )
            return
        start_url = self._build_session_launch_url(session_id=session_id, launch_token=launch_token)
        if recipient_mode_view.mode == "mention":
            mention_text = " ".join(user.mention for user in recipients)
            start_view = StartSessionView(start_url=start_url, author_id=context.author.id)
            await prompt_message.edit(
                embed=make_snitch_embed(
                    "Session is ready.\n"
                    "Doubters are locked because you chose mention mode.\n"
                    f"Doubters: {mention_text}\n"
                    "Use the button below to open Snitch, sign in with Discord, and auto-start the session."
                ),
                view=start_view,
            )
            await self._run_live_session_message(
                message=prompt_message,
                token=token,
                session_id=session_id,
                fallback_duration_seconds=duration_seconds,
                session_title=f"{context.author.display_name}'s Study Session",
                live_view=start_view,
            )
            return

        open_join_view = OpenSessionSessionView(
            cog=self,
            author_id=context.author.id,
            session_id=session_id,
            token=token,
            max_recipients=max_recipients or 1,
            duration_seconds=duration_seconds,
            start_url=start_url,
            initial_recipients={u.id: u for u in recipients},
        )
        await prompt_message.edit(
            embed=make_snitch_embed(
                "You're all set! Your session is open — anyone can join as a doubter while you study.\n"
                'Hit the button below to open Snitch and start your session.',
                title=f"{context.author.display_name}'s Study Session",
            ),
            view=open_join_view,
        )
        await self._run_live_session_message(
            message=prompt_message,
            token=token,
            session_id=session_id,
            fallback_duration_seconds=duration_seconds,
            session_title=f"{context.author.display_name}'s Study Session",
            live_view=open_join_view,
        )


async def setup(bot) -> None:
    await bot.add_cog(General(bot))
