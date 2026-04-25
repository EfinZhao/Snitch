import asyncio
import re
from typing import Optional

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
    return discord.Embed(title="Snitch", description=description, color=color)


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


class ActiveSoloJoinView(discord.ui.View):
    def __init__(
        self,
        author_id: int,
        participants_by_id: dict[int, discord.abc.User],
    ) -> None:
        super().__init__(timeout=None)
        self.author_id = author_id
        self.participants_by_id = participants_by_id

    @discord.ui.button(label="Join As Recipient", style=discord.ButtonStyle.success)
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

        self.participants_by_id[interaction.user.id] = interaction.user
        await interaction.response.send_message(
            "You joined this active snitch bet.", ephemeral=True
        )

    @discord.ui.button(label="Leave Bet", style=discord.ButtonStyle.danger)
    async def leave_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        if interaction.user.id == self.author_id:
            await interaction.response.send_message(
                "The creator cannot leave their own bet.", ephemeral=True
            )
            return
        if interaction.user.id not in self.participants_by_id:
            await interaction.response.send_message(
                "You are not currently in this bet.", ephemeral=True
            )
            return

        self.participants_by_id.pop(interaction.user.id, None)
        await interaction.response.send_message(
            "You left this active snitch bet.", ephemeral=True
        )


class General(commands.Cog, name="general"):
    def __init__(self, bot) -> None:
        self.bot = bot

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
        name="snitch",
        description="Create a solo or group snitch bet with a countdown timer.",
    )
    async def snitch(self, context: Context) -> None:
        if context.guild is None:
            await context.send(embed=make_snitch_embed("This command can only be used in a server.", is_error=True))
            return

        mode_view = ModeSelectView(context.author.id)
        prompt_message = await context.send(
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
        recipient_mode: Optional[str] = None
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

            recipient_mode = recipient_mode_view.mode

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
                if mode_view.mode == "solo":
                    recipients = []
                    await prompt_message.edit(
                        embed=make_snitch_embed(
                            "Anyone can join once the solo timer starts. Skipping pre-join phase."
                        ),
                        view=None,
                    )
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

            if mode_view.mode == "group" and not recipients:
                await prompt_message.edit(
                    embed=make_snitch_embed(
                        "Group mode requires at least one recipient. Please select recipients again.",
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

            participants_by_id: dict[int, discord.abc.User] = {
                context.author.id: context.author,
                **recipients_by_id,
            }
            active_join_view: Optional[ActiveSoloJoinView] = None
            if recipient_mode == "anyone":
                active_join_view = ActiveSoloJoinView(
                    author_id=context.author.id,
                    participants_by_id=participants_by_id,
                )

            await self._run_live_timer(
                timer_message=prompt_message,
                duration_seconds=duration_seconds,
                bet_amount=bet_amount,
                participants_by_id=participants_by_id,
                mode="solo",
                timer_view=active_join_view,
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

        await self._run_live_timer(
            timer_message=prompt_message,
            duration_seconds=duration_seconds,
            bet_amount=bet_amount,
            participants_by_id=participants_by_id,
            mode="group",
        )

    


async def setup(bot) -> None:
    await bot.add_cog(General(bot))
