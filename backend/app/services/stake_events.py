import asyncio
from collections import defaultdict
from typing import Any


class StakeEventBroker:
    def __init__(self) -> None:
        self._subscribers: dict[int, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, stake_id: int) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        async with self._lock:
            self._subscribers[stake_id].add(queue)
        return queue

    async def unsubscribe(self, stake_id: int, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            subscribers = self._subscribers.get(stake_id)
            if not subscribers:
                return
            subscribers.discard(queue)
            if not subscribers:
                self._subscribers.pop(stake_id, None)

    async def publish(self, stake_id: int, payload: dict[str, Any]) -> None:
        async with self._lock:
            subscribers = list(self._subscribers.get(stake_id, set()))
        for queue in subscribers:
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                # Skip slow subscribers; they will receive newer updates.
                continue


broker = StakeEventBroker()
