from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_models import (
    DEFAULT_CLOSEOUT_BATCH_SIZE,
    DEFAULT_CLOSEOUT_SHARD_SIZE,
    CloseoutBatch,
    CloseoutShard,
)
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticePreparedImport,
)


class CloseoutPlanner:
    def __init__(
        self,
        *,
        shard_size: int = DEFAULT_CLOSEOUT_SHARD_SIZE,
        batch_size: int = DEFAULT_CLOSEOUT_BATCH_SIZE,
        max_shards: int | None = None,
    ) -> None:
        if shard_size <= 0:
            raise ValueError("shard_size must be positive")
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")
        if max_shards is not None and max_shards <= 0:
            raise ValueError("max_shards must be positive when set")
        self.shard_size = shard_size
        self.batch_size = batch_size
        self.max_shards = max_shards

    def plan_shards(
        self,
        notices: Sequence[dict[str, Any] | AuthenticatedNoticePreparedImport],
    ) -> tuple[CloseoutShard, ...]:
        if not notices:
            return ()
        sorted_notice_ids = tuple(sorted(_extract_notice_id(item) for item in notices))
        shard_count = math.ceil(len(sorted_notice_ids) / self.shard_size)
        if self.max_shards is not None:
            shard_count = min(shard_count, self.max_shards)
        target_shard_size = math.ceil(len(sorted_notice_ids) / shard_count)
        planned: list[CloseoutShard] = []
        for offset in range(0, len(sorted_notice_ids), target_shard_size):
            planned.append(
                CloseoutShard(
                    shard_id=len(planned) + 1,
                    notice_ids=sorted_notice_ids[offset : offset + target_shard_size],
                )
            )
        return tuple(planned)

    def plan_batches(self, shards: Sequence[CloseoutShard]) -> tuple[CloseoutBatch, ...]:
        planned: list[CloseoutBatch] = []
        for shard in shards:
            for offset in range(0, len(shard.notice_ids), self.batch_size):
                planned.append(
                    CloseoutBatch(
                        batch_id=len(planned) + 1,
                        shard_id=shard.shard_id,
                        notice_ids=tuple(shard.notice_ids[offset : offset + self.batch_size]),
                    )
                )
        return tuple(planned)

    def plan_weighted_shards(
        self,
        notices: Sequence[dict[str, Any]],
        *,
        weight_by_notice_id: dict[str, int],
    ) -> tuple[CloseoutShard, ...]:
        notice_ids = tuple(sorted(_extract_notice_id(item) for item in notices))
        groups = self._plan_weighted_groups(
            notice_ids=notice_ids,
            item_limit=self.shard_size,
            max_groups=self.max_shards,
            weight_by_notice_id=weight_by_notice_id,
        )
        return tuple(
            CloseoutShard(shard_id=index + 1, notice_ids=group)
            for index, group in enumerate(groups)
        )

    def plan_weighted_batches(
        self,
        shards: Sequence[CloseoutShard],
        *,
        weight_by_notice_id: dict[str, int],
    ) -> tuple[CloseoutBatch, ...]:
        planned: list[CloseoutBatch] = []
        for shard in shards:
            groups = self._plan_weighted_groups(
                notice_ids=shard.notice_ids,
                item_limit=self.batch_size,
                max_groups=None,
                weight_by_notice_id=weight_by_notice_id,
            )
            for notice_ids in groups:
                planned.append(
                    CloseoutBatch(
                        batch_id=len(planned) + 1,
                        shard_id=shard.shard_id,
                        notice_ids=notice_ids,
                    )
                )
        return tuple(planned)

    def _plan_weighted_groups(
        self,
        *,
        notice_ids: Sequence[str],
        item_limit: int,
        max_groups: int | None,
        weight_by_notice_id: dict[str, int],
    ) -> tuple[tuple[str, ...], ...]:
        if not notice_ids:
            return ()
        group_count = math.ceil(len(notice_ids) / item_limit)
        if max_groups is not None:
            group_count = min(group_count, max_groups)
        group_count = max(1, group_count)
        target_group_size = math.ceil(len(notice_ids) / group_count)
        groups: list[list[str]] = [[] for _ in range(group_count)]
        weights = [0 for _ in range(group_count)]
        ordered = sorted(
            notice_ids,
            key=lambda notice_id: (
                -max(1, int(weight_by_notice_id.get(notice_id, 1))),
                notice_id,
            ),
        )
        for notice_id in ordered:
            candidate_indexes = [
                index for index, group in enumerate(groups) if len(group) < target_group_size
            ] or list(range(group_count))
            target_index = min(
                candidate_indexes,
                key=lambda index: (weights[index], len(groups[index]), index),
            )
            groups[target_index].append(notice_id)
            weights[target_index] += max(1, int(weight_by_notice_id.get(notice_id, 1)))
        return tuple(tuple(sorted(group)) for group in groups if group)


def _extract_notice_id(item: dict[str, Any] | AuthenticatedNoticePreparedImport) -> str:
    if isinstance(item, AuthenticatedNoticePreparedImport):
        return item.notice_id
    return str(item["notice_id"])
