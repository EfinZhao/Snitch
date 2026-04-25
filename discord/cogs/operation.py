import discord
from discord import app_commands
from discord.ext import commands
from discord.ext.commands import Context

class Operation(commands.Cog, name="operation"):
    def __init__(self, bot) -> None:
        self.bot = bot

    @commands.hybrid_command(
        name="ping",
        description="Check if the bot is alive.",
    )
    async def ping(self, context: Context) -> None:
        """
        Check if the bot is alive.

        :param context: The hybrid command context.
        """
        embed = discord.Embed(
            title="🏓 Pong!",
            description=f"The bot latency is {round(self.bot.latency * 1000)}ms.",
            color=0xBEBEFE,
        )
        await context.send(embed=embed)
        
    @commands.command(
        name="sync",
        description="Synchonizes the slash commands.",
    )
    @app_commands.describe(scope="The scope of the sync. Can be `global` or `guild`")
    @commands.is_owner()
    async def sync(self, context: Context, scope: str) -> None:
        if scope == "global":
            await context.bot.tree.sync()
            embed = discord.Embed(
                description="Slash commands have been globally synchronized.",
                color=0xBEBEFE,
            )
            await context.send(embed=embed)
            return
        elif scope == "guild":
            context.bot.tree.copy_global_to(guild=context.guild)
            await context.bot.tree.sync(guild=context.guild)
            embed = discord.Embed(
                description="Slash commands have been synchronized in this guild.",
                color=0xBEBEFE,
            )
            await context.send(embed=embed)
            return
        embed = discord.Embed(
            description="The scope must be `global` or `guild`.", color=0xE02B2B
        )
        await context.send(embed=embed)


async def setup(bot) -> None:
    await bot.add_cog(Operation(bot))
