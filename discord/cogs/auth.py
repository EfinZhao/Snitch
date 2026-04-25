import os
from typing import Any, Optional
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

import aiohttp
import discord
from discord.ext import commands
from discord.ext.commands import Context


def make_auth_embed(description: str, is_error: bool = False) -> discord.Embed:
    color = 0xE02B2B if is_error else 0x2F80ED
    return discord.Embed(title="Auth", description=description, color=color)


class AuthClient:
    def __init__(self) -> None:
        backend_base = os.getenv("BACKEND_API_BASE_URL", "http://localhost:8000/api")
        self.backend_api_base = backend_base.rstrip("/")
        self.frontend_signup_url = os.getenv("FRONTEND_SIGNUP_URL", "http://localhost:5173")
        self.frontend_payment_setup_url = os.getenv("FRONTEND_PAYMENT_SETUP_URL", "http://localhost:5173")
        self._token_cache_by_discord_uid: dict[int, str] = {}

    def signup_url_with_discord_uid(self, discord_uid: int) -> str:
        split = urlsplit(self.frontend_signup_url)
        query = dict(parse_qsl(split.query, keep_blank_values=True))
        query["discord_uid"] = str(discord_uid)
        return urlunsplit((split.scheme, split.netloc, split.path, urlencode(query), split.fragment))

    async def get_discord_account_status(
        self, discord_uid: int
    ) -> tuple[bool, str, Optional[dict[str, Any]]]:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.backend_api_base}/users/discord/{discord_uid}",
                timeout=aiohttp.ClientTimeout(total=20),
            ) as response:
                if response.status != 200:
                    detail = await response.text()
                    return (
                        False,
                        f"Could not check Discord account status ({response.status}): {detail[:250]}",
                        None,
                    )

                payload: Any = await response.json()
                if not isinstance(payload, dict):
                    return False, "Could not parse Discord account status from backend response.", None
                return True, "", payload

    async def get_backend_token_for_discord_user(
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

    async def authenticate_discord_user(
        self,
        discord_uid: int,
        require_payment_method: bool = False,
    ) -> tuple[bool, str, Optional[str], Optional[dict[str, Any]]]:
        status_ok, status_message, discord_account_status = await self.get_discord_account_status(discord_uid)
        if not status_ok or discord_account_status is None:
            return False, status_message or "Could not check your Discord account status.", None, None

        if not bool(discord_account_status.get("exists")):
            return (
                False,
                (
                    "No Snitch account is linked to your Discord yet.\n"
                    f"Create one here: {self.signup_url_with_discord_uid(discord_uid)}"
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

        logged_in, login_message, token = await self.get_backend_token_for_discord_user(
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


class Auth(commands.Cog, name="auth"):
    def __init__(self, bot) -> None:
        self.bot = bot
        self.auth_client = AuthClient()

    @commands.hybrid_command(
        name="auth",
        description="Authenticate your Discord account with Snitch.",
    )
    async def auth(self, context: Context) -> None:
        is_slash = context.interaction is not None

        if is_slash and not context.interaction.response.is_done():
            await context.interaction.response.defer(ephemeral=True, thinking=True)

        ok, auth_message, _, status = await self.auth_client.authenticate_discord_user(
            context.author.id,
            require_payment_method=False,
        )
        if not ok:
            error_embed = make_auth_embed(auth_message, is_error=True)
            if is_slash:
                await context.interaction.followup.send(embed=error_embed, ephemeral=True)
            else:
                await context.send(embed=error_embed)
            return

        payment_ready = bool((status or {}).get("payment_method_ready"))
        payout_ready = bool((status or {}).get("payout_ready"))
        success_embed = make_auth_embed(
            "Authentication successful.\n"
            f"Payment method ready: {'yes' if payment_ready else 'no'}\n"
            f"Payout ready: {'yes' if payout_ready else 'no'}"
        )
        if is_slash:
            await context.interaction.followup.send(embed=success_embed, ephemeral=True)
        else:
            await context.send(embed=success_embed)


async def setup(bot) -> None:
    await bot.add_cog(Auth(bot))