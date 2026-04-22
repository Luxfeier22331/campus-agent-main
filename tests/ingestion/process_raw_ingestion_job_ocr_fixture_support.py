from __future__ import annotations

from .process_raw_ingestion_job_base_support import *  # noqa: F401,F403


class _FakeOnlineOcrClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        provider_payload = {
            "result": {
                "dataInfo": {"numPages": 1},
                "layoutParsingResults": [
                    {
                        "markdown": {
                            "text": "remote ocr text",
                            "images": {},
                        }
                    }
                ],
            },
            "logId": "log-001",
        }
        return OnlineOcrProviderResult(
            provider_result_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode(
                "utf-8"
            ),
        )


class _VolatileFakeOnlineOcrClient:
    def __init__(self) -> None:
        self.counter = 0

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.counter += 1
        provider_payload = {
            "result": {
                "dataInfo": {"numPages": 1},
                "layoutParsingResults": [
                    {
                        "markdown": {
                            "text": "same normalized text",
                            "images": {},
                        }
                    }
                ],
            },
            "logId": f"log-{self.counter:03d}",
        }
        return OnlineOcrProviderResult(
            provider_result_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode(
                "utf-8"
            ),
        )


class _CurriculumPlanFakeOnlineOcrClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        provider_lines = [
            {
                "pageNumber": 1,
                "result": {
                    "layoutParsingResults": [
                        {
                            "blockType": "paragraph",
                            "blockId": "p1-body",
                            "readingOrder": 1,
                            "markdown": {"text": "Plan one text"},
                        }
                    ]
                },
                "logId": "log-001",
            },
            {
                "pageNumber": 2,
                "result": {
                    "layoutParsingResults": [
                        {
                            "blockType": "paragraph",
                            "blockId": "p2-body",
                            "readingOrder": 1,
                            "markdown": {"text": "Plan two text"},
                        }
                    ]
                },
                "logId": "log-002",
            },
        ]
        return OnlineOcrProviderResult(
            provider_result_bytes=(
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8"),
        )


class _StudentHandbookNormalizedFakeOnlineOcrClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        provider_lines = [
            {
                "result": {
                    "dataInfo": {
                        "numPages": 3,
                        "pages": [
                            {"width": 828, "height": 1151},
                            {"width": 828, "height": 1151},
                            {"width": 828, "height": 1151},
                        ],
                        "type": "pdf",
                    },
                    "layoutParsingResults": [
                        {
                            "prunedResult": {
                                "parsing_res_list": [
                                    {
                                        "blockType": "title",
                                        "blockId": "p1-title",
                                        "readingOrder": 1,
                                        "markdown": {"text": "中央民族大学奖学金评定办法"},
                                    },
                                    {
                                        "blockType": "paragraph",
                                        "blockId": "p1-body",
                                        "readingOrder": 2,
                                        "markdown": {
                                            "text": "第一条 奖学金评定坚持公开、公平、公正。"
                                        },
                                    },
                                ]
                            }
                        },
                        {
                            "prunedResult": {
                                "parsing_res_list": [
                                    {
                                        "blockType": "paragraph",
                                        "blockId": "p2-body",
                                        "readingOrder": 1,
                                        "markdown": {"text": "第二条 评定程序按照学校通知执行。"},
                                    }
                                ]
                            }
                        },
                        {
                            "prunedResult": {
                                "parsing_res_list": [
                                    {
                                        "blockType": "title",
                                        "blockId": "p3-title",
                                        "readingOrder": 1,
                                        "markdown": {"text": "中央民族大学学生违纪处分办法"},
                                    },
                                    {
                                        "blockType": "paragraph",
                                        "blockId": "p3-body",
                                        "readingOrder": 2,
                                        "markdown": {"text": "第一条 学生应当遵守校纪校规。"},
                                    },
                                ]
                            }
                        },
                    ],
                },
                "logId": "log-001",
            }
        ]
        return OnlineOcrProviderResult(
            provider_result_bytes=(
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8"),
        )


class _FixtureOnlineOcrClient:
    def __init__(self, fixture_name: str) -> None:
        self.calls: list[Path] = []
        self.fixture_name = fixture_name

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=(FIXTURE_DIR / self.fixture_name).read_bytes(),
        )


class _TrackingPaddleOnlineOcrClient(_FakeOnlineOcrClient):
    pass


class _SuccessfulMineruCanonicalClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_mineru_canonical_archive_bytes()
        )


class _FailingMineruCanonicalClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        raise RuntimeError("mineru failed")


class _SplitMineruCanonicalClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        canonical_payload = {
            "result": {
                "dataInfo": {"numPages": 2, "type": "pdf_or_image"},
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "doc_title",
                                    "block_content": "中央民族大学奖学金评定办法",
                                    "block_id": "seg-1-title",
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "# 中央民族大学奖学金评定办法"},
                    },
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "第一条 奖学金评定坚持公开、公平、公正。",
                                    "block_id": "seg-2-body",
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "第一条 奖学金评定坚持公开、公平、公正。"},
                    },
                ],
            }
        }
        return OnlineOcrProviderResult(
            provider_result_bytes=(json.dumps(canonical_payload, ensure_ascii=False) + "\n").encode(
                "utf-8"
            ),
            metadata={
                "provider": "mineru_api",
                "file_name": pdf_path.name,
                "state": "done",
                "page_count": 201,
                "split_applied": True,
                "segment_count": 2,
            },
            raw_provider_artifacts=(
                OnlineOcrRawArtifact(
                    filename="provider-response-raw.part-0001.zip",
                    content_type="application/zip",
                    data=_build_mineru_canonical_archive_bytes(),
                ),
                OnlineOcrRawArtifact(
                    filename="provider-response-raw.part-0002.zip",
                    content_type="application/zip",
                    data=_build_mineru_canonical_archive_bytes(),
                ),
                OnlineOcrRawArtifact(
                    filename="provider-response-raw.manifest.json",
                    content_type="application/json",
                    data=(
                        json.dumps(
                            {
                                "schema_version": "mineru_raw_pdf_split_manifest_v1",
                                "segment_count": 2,
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    ).encode("utf-8"),
                ),
            ),
        )


class _SimpleTablePaddleImageClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_simple_table_paddle_provider_response_bytes(),
        )


class _WeakPaddleImageClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_weak_paddle_provider_response_bytes(),
        )


class _SparseMapPaddleImageClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_sparse_map_paddle_provider_response_bytes(),
        )


class _EmptyMineruImageClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_empty_mineru_image_archive_bytes(),
        )


class _ComplexTableMineruImageClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_complex_table_mineru_image_archive_bytes(),
        )


class _SpatialMineruImageClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(file_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=_build_spatial_mineru_image_archive_bytes(),
        )


def _build_mineru_canonical_archive_bytes() -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "sample_content_list.json",
            json.dumps(
                [
                    {
                        "type": "text",
                        "text": "中央民族大学奖学金评定办法",
                        "text_level": 1,
                        "bbox": [10, 20, 300, 80],
                        "page_idx": 0,
                    },
                    {
                        "type": "text",
                        "text": "第一条 奖学金评定坚持公开、公平、公正。",
                        "text_level": 0,
                        "bbox": [10, 100, 900, 180],
                        "page_idx": 0,
                    },
                ],
                ensure_ascii=False,
            ),
        )
        archive.writestr(
            "full.md",
            "# 中央民族大学奖学金评定办法\n\n第一条 奖学金评定坚持公开、公平、公正。\n",
        )
    return buffer.getvalue()


def _build_empty_mineru_image_archive_bytes() -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("sample_content_list.json", json.dumps([], ensure_ascii=False))
        archive.writestr("full.md", "")
    return buffer.getvalue()


def _build_complex_table_mineru_image_archive_bytes() -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "sample_content_list.json",
            json.dumps(
                [
                    {
                        "type": "text",
                        "text": "课程安排说明",
                        "text_level": 1,
                        "bbox": [10, 20, 300, 80],
                        "page_idx": 0,
                    },
                    {
                        "type": "table",
                        "table_body": (
                            "<table><tr><td>课程</td><td>周一</td><td>周二</td></tr>"
                            "<tr><td>民族学导论</td><td>1-2节</td><td>3-4节</td></tr>"
                            "<tr><td>语言学概论</td><td>5-6节</td><td>7-8节</td></tr>"
                            "<tr><td>田野调查方法</td><td>9-10节</td><td>11-12节</td></tr></table>"
                        ),
                        "bbox": [10, 100, 1400, 900],
                        "page_idx": 0,
                    },
                ],
                ensure_ascii=False,
            ),
        )
        archive.writestr(
            "full.md",
            (
                "# 课程安排说明\n\n"
                "<table><tr><td>课程</td><td>周一</td><td>周二</td></tr>"
                "<tr><td>民族学导论</td><td>1-2节</td><td>3-4节</td></tr>"
                "<tr><td>语言学概论</td><td>5-6节</td><td>7-8节</td></tr>"
                "<tr><td>田野调查方法</td><td>9-10节</td><td>11-12节</td></tr></table>\n"
            ),
        )
    return buffer.getvalue()


def _build_spatial_mineru_image_archive_bytes() -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "sample_content_list.json",
            json.dumps(
                [
                    {
                        "type": "image",
                        "bbox": [0, 0, 1000, 800],
                        "page_idx": 0,
                    }
                ],
                ensure_ascii=False,
            ),
        )
        archive.writestr("full.md", "![campus-map](page-1.png)\n")
    return buffer.getvalue()


def _build_simple_table_paddle_provider_response_bytes() -> bytes:
    payload = {
        "result": {
            "dataInfo": {"numPages": 1},
            "layoutParsingResults": [
                {
                    "markdown": {
                        "text": (
                            "<table>"
                            "<tr><td>楼名</td><td>房间号</td><td>值班电话</td></tr>"
                            "<tr><td>综合楼</td><td>109室</td><td>83877535</td></tr>"
                            "<tr><td>日新楼</td><td>108室</td><td>83874831</td></tr>"
                            "</table>"
                        )
                    }
                }
            ],
        }
    }
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def _build_weak_paddle_provider_response_bytes() -> bytes:
    payload = {
        "result": {
            "dataInfo": {"numPages": 1},
            "layoutParsingResults": [{"markdown": {"text": "课程安排说明"}}],
        }
    }
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


def _build_sparse_map_paddle_provider_response_bytes() -> bytes:
    payload = {
        "result": {
            "dataInfo": {"numPages": 1},
            "layoutParsingResults": [{"markdown": {"text": "综合楼\n理工楼\n学生食堂"}}],
        }
    }
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


__all__ = [name for name in globals() if not name.startswith("__")]
