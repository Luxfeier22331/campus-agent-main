from __future__ import annotations

import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "apps" / "public-docs" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _sync_real_docs.handbook import _clean_handbook_markdown


_FORM_TABLE_HTML = """<table><tr><td rowspan="6">本人情况</td><td>姓名</td><td colspan="2"></td><td>性别</td><td></td><td>出生年月</td><td></td><td rowspan="6">照片</td></tr><tr><td>民族</td><td colspan="2"></td><td>政治面貌</td><td></td><td>入学时间</td><td></td></tr><tr><td>身份证号码</td><td colspan="4"></td><td>个人联系电话</td><td></td></tr><tr><td>学号</td><td colspan="4"></td><td>贫困认定等级</td><td></td></tr><tr><td colspan="2">学校的办理农行卡号</td><td colspan="5"></td></tr><tr><td colspan="7">院系 专业 班级</td></tr><tr><td rowspan="3">家庭经济情况</td><td>家庭户口</td><td colspan="5">A、城镇 B、农村</td><td>家庭电话</td><td></td></tr><tr><td>家庭月总收入</td><td colspan="2"></td><td colspan="2">人均月收入</td><td></td><td>收入来源</td><td></td></tr><tr><td>家庭住址</td><td colspan="5"></td><td>邮政编码</td><td></td></tr><tr><td rowspan="6">家庭成员情况</td><td>姓名</td><td colspan="2">年龄</td><td colspan="2">与本人关系</td><td colspan="3">工作单位及职务</td></tr><tr><td></td><td colspan="2"></td><td colspan="2"></td><td colspan="3"></td></tr><tr><td></td><td colspan="2"></td><td colspan="2"></td><td colspan="3"></td></tr><tr><td></td><td colspan="2"></td><td colspan="2"></td><td colspan="3"></td></tr><tr><td></td><td colspan="2"></td><td colspan="2"></td><td colspan="3"></td></tr><tr><td></td><td colspan="2"></td><td colspan="2"></td><td colspan="3"></td></tr><tr><td colspan="9">曾获资助情况:</td></tr><tr><td colspan="9">申请理由:\n申请人签名: 年 月 日</td></tr><tr><td colspan="6">院系审核意见:\n(公章)\n年 月 日</td><td colspan="3">助学服务中心审核意见:\n(公章)年 月 日</td></tr></table>"""


class PublicDocsSyncHandbookTest(unittest.TestCase):
    def test_clean_handbook_markdown_does_not_escape_list_item_with_missing_space(self) -> None:
        markdown = "\n".join(
            [
                "---",
                "title: '中央民族大学关于学生宿舍照明的管理规定'",
                "---",
                "",
                "## 一、时间安排",
                "2.6月1日至9月30日,学生宿舍不统一熄灯。",
                "",
            ]
        )

        cleaned = _clean_handbook_markdown(markdown)

        self.assertIn("2.6月1日至9月30日,学生宿舍不统一熄灯。", cleaned)
        self.assertNotIn("2\\.6月", cleaned)

    def test_clean_handbook_markdown_does_not_escape_grade_range_as_decimal_label(self) -> None:
        markdown = "\n".join(
            [
                "---",
                "title: '中央民族大学推荐应届本科毕业生免试攻读硕士学位研究生管理办法'",
                "---",
                "",
                "(二)成绩要求",
                "1.1-3学年所修课程平均成绩在本专业排名前 $30\\%$",
                "",
            ]
        )

        cleaned = _clean_handbook_markdown(markdown)

        self.assertIn("1.1-3学年所修课程平均成绩", cleaned)
        self.assertNotIn("1\\.1-3学年", cleaned)

    def test_clean_handbook_markdown_preserves_complex_form_table_as_html(self) -> None:
        markdown = "\n".join(
            [
                "---",
                "title: '中央民族大学本科生国家助学金评审办法'",
                "---",
                "",
                "## 中央民族大学国家助学金申请表",
                "",
                "[表格]",
                _FORM_TABLE_HTML,
                "",
            ]
        )

        cleaned = _clean_handbook_markdown(markdown)

        self.assertIn("<table>", cleaned)
        self.assertIn("院系审核意见", cleaned)
        self.assertIn("助学服务中心审核意见", cleaned)
        self.assertNotIn("- 本人情况：院系审核意见", cleaned)
        self.assertNotIn("  - 姓名：院系审核意见", cleaned)

    def test_clean_handbook_markdown_preserves_section_label_form_rows_as_html(self) -> None:
        markdown = "\n".join(
            [
                "---",
                "title: '中央民族大学学院(系)学生基本情况周查月报制度'",
                "---",
                "",
                "[表格]",
                (
                    '<table><tr><td colspan="3">经核查,月,本学院(系)在籍本(预)科学生中存在以下情况者共计人次。'
                    '填表人:</td></tr><tr><td>类型</td><td>原因</td><td>学生基本信息(姓名、学号、起止时间)</td></tr>'
                    '<tr><td rowspan="4">有无违纪违法学生</td><td>违反法律、法规</td><td></td></tr>'
                    '<tr><td>其他需报告的重要情况</td><td></td></tr>'
                    '<tr><td colspan="2">有无心理健康状况异常学生</td><td></td></tr></table>'
                ),
                "",
            ]
        )

        cleaned = _clean_handbook_markdown(markdown)

        self.assertIn("<table>", cleaned)
        self.assertIn("有无心理健康状况异常学生", cleaned)
        self.assertNotIn("### 有无心理健康状况异常学生", cleaned)

    def test_clean_handbook_markdown_preserves_compact_student_card_form_as_html(self) -> None:
        markdown = "\n".join(
            [
                "---",
                "title: '中央民族大学本科(预科)学生证管理办法'",
                "---",
                "",
                "[表格]",
                (
                    '<table><tr><td>姓名</td><td></td><td>学院(系)领导签字</td><td></td></tr>'
                    '<tr><td>学号</td><td></td><td>家庭所在地</td><td></td></tr>'
                    '<tr><td>民族</td><td></td><td>火车到站站名</td><td></td></tr>'
                    '<tr><td>学院(系)</td><td></td><td rowspan="4" colspan="2">照片\n'
                    "(请在照片背面加盖骑缝章)</td></tr>"
                    "<tr><td>专业</td><td></td></tr>"
                    "<tr><td>学制</td><td></td></tr>"
                    "<tr><td>出生年月日</td><td></td></tr></table>"
                ),
                "",
            ]
        )

        cleaned = _clean_handbook_markdown(markdown)

        self.assertIn("<table>", cleaned)
        self.assertIn("学院(系)领导签字", cleaned)
        self.assertNotIn("|姓名|", cleaned)
        self.assertNotIn("|照片", cleaned)

    def test_clean_handbook_markdown_preserves_multirow_header_table_as_html(self) -> None:
        markdown = "\n".join(
            [
                "---",
                "title: '中央民族大学本科学生综合素质测评办法'",
                "---",
                "",
                "[表格]",
                (
                    '<table><tr><td rowspan="2">奖项级别</td><td colspan="2">国家级</td><td colspan="2">校级</td></tr>'
                    "<tr><td>个人</td><td>集体</td><td>个人</td><td>集体</td></tr>"
                    "<tr><td>第一名(一等奖)</td><td>1.7</td><td>1.5</td><td>0.9</td><td>0.8</td></tr></table>"
                ),
                "",
            ]
        )

        cleaned = _clean_handbook_markdown(markdown)

        self.assertIn("<table>", cleaned)
        self.assertIn('rowspan="2">奖项级别</td>', cleaned)
        self.assertNotIn("|奖项级别|国家级|国家级|", cleaned)


if __name__ == "__main__":
    unittest.main()
