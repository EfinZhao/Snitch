import asyncio
import os
import re
from typing import Any, Optional

import aiohttp
import discord
from discord.ext import commands
from discord.ext.commands import Context


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


class ModeSelectView(discord.ui.View):
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

    @discord.ui.button(label="Solo", style=discord.ButtonStyle.primary)
    async def solo_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        self.mode = "solo"
        for child in self.children:
            child.disabled = True
        await interaction.response.edit_message(
            embed=make_snitch_embed("Mode selected: **Solo**"), view=self
        )
        self.stop()

    @discord.ui.button(label="Group", style=discord.ButtonStyle.secondary)
    async def group_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        self.mode = "group"
        for child in self.children:
            child.disabled = True
        await interaction.response.edit_message(
            embed=make_snitch_embed("Mode selected: **Group**"), view=self
        )
        self.stop()


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


class JoinRecipientsView(discord.ui.View):
    def __init__(self, author_id: int) -> None:
        super().__init__(timeout=300)
        self.author_id = author_id
        self.recipients: dict[int, discord.abc.User] = {}
        self.finished = False

    def _recipient_text(self) -> str:
        if not self.recipients:
            return "No recipients yet."
        return "Recipients: " + ", ".join(user.mention for user in self.recipients.values())

    @discord.ui.button(label="Join Bet", style=discord.ButtonStyle.success)
    async def join_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        if interaction.user.bot:
            await interaction.response.send_message(
                "Bots cannot join this bet.", ephemeral=True
            )
            return
        if interaction.user.id == self.author_id:
            await interaction.response.send_message(
                "You are already included as the creator.", ephemeral=True
            )
            return
        self.recipients[interaction.user.id] = interaction.user
        await interaction.response.edit_message(
            embed=make_snitch_embed(self._recipient_text()),
            view=self,
        )

    @discord.ui.button(label="Leave Bet", style=discord.ButtonStyle.danger)
    async def leave_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        self.recipients.pop(interaction.user.id, None)
        await interaction.response.edit_message(
            embed=make_snitch_embed(self._recipient_text()),
            view=self,
        )

    @discord.ui.button(label="Done", style=discord.ButtonStyle.primary)
    async def done_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                "Only the command starter can finish recipient selection.",
                ephemeral=True,
            )
            return
        self.finished = True
        for child in self.children:
            child.disabled = True
        await interaction.response.edit_message(
            embed=make_snitch_embed(self._recipient_text()),
            view=self,
        )
        self.stop()


class SoloStartView(discord.ui.View):
    def __init__(self, author_id: int) -> None:
        super().__init__(timeout=300)
        self.author_id = author_id
        self.started = False

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                "Only the command starter can start this timer.", ephemeral=True
            )
            return False
        return True

    @discord.ui.button(label="Start", style=discord.ButtonStyle.success)
    async def start_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        self.started = True
        for child in self.children:
            child.disabled = True
        await interaction.response.edit_message(
            embed=make_snitch_embed("Timer started."),
            view=self,
        )
        self.stop()


class GroupStartView(discord.ui.View):
    def __init__(self, participant_ids: set[int]) -> None:
        super().__init__(timeout=600)
        self.participant_ids = participant_ids
        self.ready_ids: set[int] = set()
        self.started = False

    def _status_text(self) -> str:
        remaining = self.participant_ids - self.ready_ids
        return (
            f"Ready: {len(self.ready_ids)}/{len(self.participant_ids)}. "
            f"Waiting on {len(remaining)} participant(s)."
        )

    @discord.ui.button(label="Start / I'm Ready", style=discord.ButtonStyle.success)
    async def ready_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        if interaction.user.id not in self.participant_ids:
            await interaction.response.send_message(
                "You are not part of this bet.", ephemeral=True
            )
            return

        self.ready_ids.add(interaction.user.id)
        if self.ready_ids == self.participant_ids:
            self.started = True
            for child in self.children:
                child.disabled = True
            await interaction.response.edit_message(
                embed=make_snitch_embed("All participants are ready. Timer started."),
                view=self,
            )
            self.stop()
            return

        await interaction.response.edit_message(
            embed=make_snitch_embed(self._status_text()),
            view=self,
        )


class General(commands.Cog, name="general"):
    def __init__(self, bot) -> None:
        self.bot = bot
        backend_base = os.getenv("BACKEND_API_BASE_URL", "http://localhost:8000/api")
        self.backend_api_base = backend_base.rstrip("/")
        self.frontend_signup_url = os.getenv("FRONTEND_SIGNUP_URL", "http://localhost:5173")
        self.frontend_payment_setup_url = os.getenv("FRONTEND_PAYMENT_SETUP_URL", "http://localhost:5173")
        self._token_cache_by_discord_uid: dict[int, str] = {}

    async def _get_discord_account_status(self, discord_uid: int) -> tuple[bool, str, Optional[dict[str, Any]]]:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.backend_api_base}/users/discord/{discord_uid}",
                timeout=aiohttp.ClientTimeout(total=20),
            ) as response:
                if response.status != 200:
                    detail = await response.text()
                    return False, f"Could not check Discord account status ({response.status}): {detail[:250]}", None

                payload: Any = await response.json()
                if not isinstance(payload, dict):
                    return False, "Could not parse Discord account status from backend response.", None
                return True, "", payload

    async def _get_backend_token_for_discord_user(
        self,
        discord_uid: int,
        discord_account_status: Optional[dict[str, Any]] = None,
    ) -> tuple[bool, str, Optional[str]]:
        # New flow: attempt to read token from the Discord status payload when provided.
        if isinstance(discord_account_status, dict):
            status_token = discord_account_status.get("access_token") or discord_account_status.get("token")
            if status_token:
                return True, "", str(status_token)

        # Backward-compatible fallback for environments still exposing legacy Discord login.
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.backend_api_base}/auth/discord-login/{discord_uid}",
                timeout=aiohttp.ClientTimeout(total=20),
            ) as response:
                if response.status == 404:
                    return False, "backend_discord_auth_not_available", None
                if response.status != 200:
                    detail = await response.text()
                    return False, f"Backend login failed ({response.status}): {detail[:250]}", None

                payload: Any = await response.json()
                token = payload.get("access_token") if isinstance(payload, dict) else None
                if not token:
                    return False, "Backend login response did not include an access token.", None
                return True, "", str(token)

    async def _authenticate_discord_user(
        self,
        discord_uid: int,
        require_payment_method: bool = False,
    ) -> tuple[bool, str, Optional[str], Optional[dict[str, Any]]]:
        status_ok, status_message, discord_account_status = await self._get_discord_account_status(discord_uid)
        if not status_ok or discord_account_status is None:
            return False, status_message or "Could not check your Discord account status.", None, None

        if not bool(discord_account_status.get("exists")):
            return (
                False,
                (
                    "No Snitch account is linked to your Discord yet.\n"
                    f"Create one here: {self.frontend_signup_url}"
                ),
                None,
                discord_account_status,
            )

        if require_payment_method and not bool(discord_account_status.get("payment_method_ready")):
            return (
                False,
                (
                    "No saved payment method found.\n"
                    f"Connect one here: {self.frontend_payment_setup_url}"
                ),
                None,
                discord_account_status,
            )

        logged_in, login_message, token = await self._get_backend_token_for_discord_user(
            discord_uid,
            discord_account_status=discord_account_status,
        )

        # If backend cannot issue a token right now, reuse a prior token if available.
        if (not logged_in or token is None) and login_message == "backend_discord_auth_not_available":
            cached = self._token_cache_by_discord_uid.get(discord_uid)
            if cached:
                return True, "", cached, discord_account_status

        if not logged_in or token is None:
            auth_message = login_message
            if login_message == "backend_discord_auth_not_available":
                auth_message = (
                    "Could not get an API token for your Discord-linked account. "
                    "Please ask the backend team to expose a Discord token issuance endpoint."
                )
            return False, auth_message or "Could not authenticate with backend.", None, discord_account_status

        self._token_cache_by_discord_uid[discord_uid] = token
        return True, "", token, discord_account_status

    @commands.hybrid_command(
        name="auth",
        description="Authenticate your Discord account with Snitch.",
    )
    async def auth(self, context: Context) -> None:
        is_slash = context.interaction is not None

        if is_slash and not context.interaction.response.is_done():
            await context.interaction.response.defer(ephemeral=True, thinking=True)

        ok, auth_message, _, status = await self._authenticate_discord_user(
            context.author.id,
            require_payment_method=False,
        )
        if not ok:
            error_embed = make_snitch_embed(auth_message, is_error=True)
            if is_slash:
                await context.interaction.followup.send(embed=error_embed, ephemeral=True)
            else:
                await context.send(embed=error_embed)
            return

        payment_ready = bool((status or {}).get("payment_method_ready"))
        payout_ready = bool((status or {}).get("payout_ready"))
        success_embed = make_snitch_embed(
            "Authentication successful.\n"
            f"Payment method ready: {'yes' if payment_ready else 'no'}\n"
            f"Payout ready: {'yes' if payout_ready else 'no'}"
        )
        if is_slash:
            await context.interaction.followup.send(embed=success_embed, ephemeral=True)
        else:
            await context.send(embed=success_embed)

    async def _create_stake_via_api(
        self,
        token: str,
        amount_cents: int,
        duration_seconds: int,
        recipient_usernames: list[str],
    ) -> tuple[bool, str, Optional[int]]:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        body = {
            "amount_cents": amount_cents,
            "duration_seconds": duration_seconds,
            "recipient_usernames": recipient_usernames,
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

    async def _activate_stake_via_api(
        self,
        token: str,
        stake_id: int,
    ) -> tuple[bool, str]:
        headers = {"Authorization": f"Bearer {token}"}

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.backend_api_base}/stakes/{stake_id}/activate",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as response:
                if response.status != 200:
                    detail = await response.text()
                    return False, f"Stake activation failed ({response.status}): {detail[:300]}"
                return True, ""

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

    def _participants_text(self, participants: list[discord.abc.User]) -> str:
        if not participants:
            return "No participants"
        return ", ".join(user.mention for user in participants)

    async def _run_live_timer(
        self,
        timer_message: discord.Message,
        duration_seconds: int,
        bet_amount: float,
        participants_by_id: dict[int, discord.abc.User],
        mode: str,
        timer_view: Optional[discord.ui.View] = None,
    ) -> None:
        # Short timers get 1s updates; longer ones update every 5s to avoid API spam.
        tick_seconds = 1 if duration_seconds <= 180 else 5
        remaining = duration_seconds

        while remaining > 0:
            participants = list(participants_by_id.values())
            await timer_message.edit(
                embed=make_snitch_embed(
                    f"Snitch timer running ({mode}).\n"
                    f"Bet: ${bet_amount:.2f}\n"
                    f"Time left: **{format_duration(remaining)}**\n"
                    f"Participants: {self._participants_text(participants)}"
                ),
                view=timer_view,
            )

            sleep_seconds = min(tick_seconds, remaining)
            await asyncio.sleep(sleep_seconds)
            remaining -= sleep_seconds

        if timer_view is not None:
            for child in timer_view.children:
                child.disabled = True
            timer_view.stop()

        final_participants = list(participants_by_id.values())
        await timer_message.edit(
            embed=make_snitch_embed(
                f"Time is up.\n"
                f"Bet: ${bet_amount:.2f}\n"
                f"Final participants: {self._participants_text(final_participants)}"
            ),
            view=timer_view,
        )

    @commands.hybrid_command(
        name="stake",
        description="Create a solo or group stake with a countdown timer.",
    )
    async def stake(self, context: Context) -> None:
        if context.guild is None:
            await context.send(embed=make_snitch_embed("This command can only be used in a server.", is_error=True))
            return

        initial_message = await context.send(
            embed=make_snitch_embed("Checking your Snitch account..."),
            view=None,
        )
        auth_ok, auth_message, token, _ = await self._authenticate_discord_user(
            context.author.id,
            require_payment_method=True,
        )
        if not auth_ok or token is None:
            await initial_message.edit(
                embed=make_snitch_embed(auth_message or "Could not authenticate with backend.", is_error=True),
                view=None,
            )
            return

        mode_view = ModeSelectView(context.author.id)
        prompt_message = initial_message
        await prompt_message.edit(
            embed=make_snitch_embed("Pick a mode for this bet:"),
            view=mode_view,
        )
        await mode_view.wait()
        if mode_view.mode is None:
            await prompt_message.edit(
                embed=make_snitch_embed("No mode selected in time. Command canceled.", is_error=True),
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

        recipients: list[discord.abc.User] = []
        while True:
            recipient_mode_view = RecipientModeView(context.author.id)
            await prompt_message.edit(
                embed=make_snitch_embed("Choose recipient selection: mention recipients or open it for anyone to join."),
                view=recipient_mode_view,
            )
            await recipient_mode_view.wait()
            if recipient_mode_view.mode is None:
                await prompt_message.edit(
                    embed=make_snitch_embed("No recipient mode selected in time. Command canceled.", is_error=True),
                    view=None,
                )
                return

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

                recipients = [
                    member
                    for member in mention_message.mentions
                    if (not member.bot and member.id != context.author.id)
                ]
            else:
                join_view = JoinRecipientsView(context.author.id)
                await prompt_message.edit(
                    embed=make_snitch_embed("Anyone can click **Join Bet** now. Click **Done** when you are finished."),
                    view=join_view,
                )
                await join_view.wait()
                if not join_view.finished:
                    await prompt_message.edit(
                        embed=make_snitch_embed("Recipient join window timed out. Command canceled.", is_error=True),
                        view=None,
                    )
                    return
                recipients = list(join_view.recipients.values())

            if not recipients:
                await prompt_message.edit(
                    embed=make_snitch_embed(
                        "At least one recipient is required. Please select recipients again.",
                        is_error=True,
                    ),
                    view=None,
                )
                continue
            break

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

        recipient_usernames = sorted({user.name.strip().lower() for user in recipients if user.name.strip()})
        if mode_view.mode == "group" and not recipient_usernames:
            await prompt_message.edit(
                embed=make_snitch_embed(
                    "Could not derive valid group recipient usernames from Discord users.",
                    is_error=True,
                ),
                view=None,
            )
            return

        amount_cents = int(round(bet_amount * 100))
        await prompt_message.edit(
            embed=make_snitch_embed(
                f"Creating stake via API...\n"
                f"Amount: ${bet_amount:.2f}\n"
                f"Mode: {mode_view.mode}\n"
                f"Duration: {format_duration(duration_seconds)}\n"
                f"Recipients: {', '.join(recipient_usernames) if recipient_usernames else 'none yet'}"
            ),
            view=None,
        )
        created, creation_message, stake_id = await self._create_stake_via_api(
            token=token,
            amount_cents=amount_cents,
            duration_seconds=duration_seconds,
            recipient_usernames=recipient_usernames,
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
        await asyncio.sleep(1)

        recipients_by_id: dict[int, discord.abc.User] = {user.id: user for user in recipients}

        if mode_view.mode == "solo":
            solo_start_view = SoloStartView(context.author.id)
            await prompt_message.edit(
                embed=make_snitch_embed("Click **Start** to begin your solo timer."),
                view=solo_start_view,
            )
            await solo_start_view.wait()
            if not solo_start_view.started:
                await prompt_message.edit(
                    embed=make_snitch_embed("Start was not clicked in time. Command canceled.", is_error=True),
                    view=None,
                )
                return

            if stake_id is not None:
                activated, activation_message = await self._activate_stake_via_api(
                    token=token,
                    stake_id=stake_id,
                )
                if not activated:
                    await prompt_message.edit(
                        embed=make_snitch_embed(activation_message, is_error=True),
                        view=None,
                    )
                    return

            participants_by_id: dict[int, discord.abc.User] = {
                context.author.id: context.author,
                **recipients_by_id,
            }

            await self._run_live_timer(
                timer_message=prompt_message,
                duration_seconds=duration_seconds,
                bet_amount=bet_amount,
                participants_by_id=participants_by_id,
                mode="solo",
            )
            return

        participants_by_id: dict[int, discord.abc.User] = {context.author.id: context.author}
        for user in recipients:
            participants_by_id[user.id] = user

        start_view = GroupStartView(set(participants_by_id.keys()))
        mention_text = " ".join(user.mention for user in participants_by_id.values())
        await prompt_message.edit(
            embed=make_snitch_embed(
                f"Group bet participants: {mention_text}\nEveryone must click **Start / I'm Ready**."
            ),
            view=start_view,
        )
        await start_view.wait()
        if not start_view.started:
            missing_ids = start_view.participant_ids - start_view.ready_ids
            missing_mentions = " ".join(f"<@{user_id}>" for user_id in missing_ids)
            await prompt_message.edit(
                embed=make_snitch_embed(
                    f"Not everyone started in time. Missing: {missing_mentions}. Command canceled.",
                    is_error=True,
                ),
                view=None,
            )
            return

        if stake_id is not None:
            activated, activation_message = await self._activate_stake_via_api(
                token=token,
                stake_id=stake_id,
            )
            if not activated:
                await prompt_message.edit(
                    embed=make_snitch_embed(activation_message, is_error=True),
                    view=None,
                )
                return

        await self._run_live_timer(
            timer_message=prompt_message,
            duration_seconds=duration_seconds,
            bet_amount=bet_amount,
            participants_by_id=participants_by_id,
            mode="group",
        )

    


async def setup(bot) -> None:
    await bot.add_cog(General(bot))
