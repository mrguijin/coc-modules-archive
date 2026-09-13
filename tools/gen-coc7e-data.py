#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从《COC七版规则空白卡CY21.1.xlsx》抽取并归一化 COC 7e 参考数据。

产出：
  src/data/skills.js          —— 技能表（键名/中文名/基础值/分类/专攻组）
  src/data/occupations.js     —— 229 条职业（信用评级区间、技能点公式、本职技能、简述）
  backend/lib/reference.js    —— 服务端权威校验表（技能键、基础值、专攻预设、职业点数规则）

用法：
  python tools/gen-coc7e-data.py <xlsx路径>

数据只用于本站车卡系统的规则计算，版权归 Chaosium 与译者所有。
"""
import json
import os
import re
import sys

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# ---------------------------------------------------------------- 技能主表
# (key, 中文名, 基础值, 分类, 专攻组, 标记)
SKILLS = [
    ("accounting", "会计", 5, "学问", None, ""),
    ("anthropology", "人类学", 1, "学问", None, ""),
    ("appraise", "估价", 5, "调查", None, ""),
    ("archaeology", "考古学", 1, "学问", None, ""),
    ("charm", "取悦", 15, "交涉", None, ""),
    ("climb", "攀爬", 20, "特技", None, ""),
    ("computer", "计算机使用", 5, "支援", None, "modern"),
    ("credit", "信用评级", 0, "交涉", None, "nocap"),
    ("cthulhu", "克苏鲁神话", 0, "学问", None, "nocap"),
    ("disguise", "乔装", 5, "特技", None, ""),
    ("dodge", "闪避", None, "战斗", None, "dexHalf"),
    ("driveAuto", "汽车驾驶", 20, "支援", None, ""),
    ("elecRepair", "电气维修", 10, "支援", None, ""),
    ("electronics", "电子学", 1, "支援", None, "modern"),
    ("fastTalk", "话术", 5, "交涉", None, ""),
    ("fighting", "格斗", 25, "战斗", "fighting", "spec"),
    ("firearms", "射击", 20, "战斗", "firearms", "spec"),
    ("firstAid", "急救", 30, "支援", None, ""),
    ("history", "历史", 5, "学问", None, ""),
    ("intimidate", "恐吓", 15, "交涉", None, ""),
    ("jump", "跳跃", 20, "特技", None, ""),
    ("language", "外语", 1, "学问", "language", "spec"),
    ("ownLanguage", "母语", None, "学问", None, "edu,named"),
    ("law", "法律", 5, "学问", None, ""),
    ("library", "图书馆使用", 20, "调查", None, ""),
    ("listen", "聆听", 20, "调查", None, ""),
    ("locksmith", "锁匠", 1, "支援", None, ""),
    ("mechRepair", "机械维修", 10, "支援", None, ""),
    ("medicine", "医学", 1, "学问", None, ""),
    ("naturalWorld", "博物学", 10, "学问", None, ""),
    ("navigate", "导航", 10, "特技", None, ""),
    ("occult", "神秘学", 5, "学问", None, ""),
    ("opHeavyMachine", "操作重型机械", 1, "支援", None, ""),
    ("persuade", "说服", 10, "交涉", None, ""),
    ("drive", "驾驶", 1, "支援", "drive", "spec"),
    ("psychoanalysis", "精神分析", 1, "学问", None, ""),
    ("psychology", "心理学", 10, "学问", None, ""),
    ("ride", "骑术", 5, "特技", None, ""),
    ("science", "科学", 1, "学问", "science", "spec"),
    ("sleightOfHand", "妙手", 10, "特技", None, ""),
    ("spotHidden", "侦查", 25, "调查", None, ""),
    ("stealth", "潜行", 20, "特技", None, ""),
    ("survival", "生存", 10, "特技", "survival", "spec"),
    ("swim", "游泳", 20, "特技", None, ""),
    ("throw", "投掷", 20, "战斗", None, ""),
    ("track", "追踪", 10, "特技", None, ""),
    ("animalHandling", "驯兽", 5, "特技", None, ""),
    ("diving", "潜水", 1, "特技", None, ""),
    ("demolitions", "爆破", 1, "支援", None, ""),
    ("lipReading", "读唇", 1, "特技", None, ""),
    ("hypnosis", "催眠", 1, "学问", None, ""),
    ("artillery", "炮术", 1, "战斗", None, ""),
    ("lore", "学识", 1, "学问", "lore", "spec"),
    ("art", "技艺", 5, "特技", "art", "spec"),
]

# 专攻组预设：预设名 -> 基础值（未列出者取该组默认基础值）
SPEC_PRESETS = {
    "fighting": {"斗殴": 25, "鞭子": 5, "电锯": 10, "斧": 15, "剑": 20, "绞具": 15, "链枷": 10, "矛": 20},
    "firearms": {"手枪": 20, "步枪/霰弹枪": 25, "冲锋枪": 15, "弓术": 15, "喷射器": 10, "机枪": 10, "重武器": 10},
    "science": {"数学": 10},
    "art": {},
    "language": {},
    "drive": {},
    "survival": {},
    "lore": {},
}

# 每个专攻组的默认可用槽位数（对齐 Excel 人物卡版面）
SPEC_SLOTS = {"art": 3, "fighting": 3, "firearms": 3, "language": 3, "science": 3,
              "drive": 1, "survival": 1, "lore": 1}

# 专攻组的下拉可选项（规则书常见方向；未列入者按该组默认基础值计算）
SPEC_OPTIONS = {
    "art": ["表演", "摄影", "写作", "绘画", "书法", "烹饪", "木工", "理发", "裁缝",
            "歌唱", "乐器", "舞蹈", "焊接", "机械制图", "伪造", "园艺",
            "管道工", "耕作", "打字", "速记", "游戏", "杂技", "喜剧"],
    "language": ["拉丁语", "古希腊语", "法语", "德语", "西班牙语", "意大利语", "俄语",
                 "阿拉伯语", "希伯来语", "汉语", "日语", "梵语", "古英语"],
    "science": ["数学", "天文学", "物理学", "化学", "生物学", "地质学", "动物学",
                "植物学", "药学", "工程学", "司法科学", "气象学", "考古学"],
    "drive": ["飞行器", "船", "马车", "自行车", "热气球"],
    "survival": ["沙漠", "海洋", "极地", "丛林", "山地", "城市", "沼泽"],
    "lore": ["神话学", "民间传说", "地方志", "家谱学", "佛教", "神道教", "道教", "阴阳道"],
    "fighting": ["斗殴", "鞭子", "电锯", "斧", "剑", "绞具", "链枷", "矛"],
    "firearms": ["手枪", "步枪/霰弹枪", "冲锋枪", "弓术", "喷射器", "机枪", "重武器"],
}

# 专攻组 -> 技能键（"技艺"→art、"外语"→language……）
SPEC_GROUP_KEY = {spec: key for (key, _cn, _b, _c, spec, _f) in SKILLS if spec}

# 原文里的具体分支名 -> (专攻组, 规范分支名)。规范名必须出现在 SPEC_OPTIONS[组] 里。
# ⚠️ 不要收录本身就是独立技能的名字（如「考古学」既是科学分支也是独立技能），否则会误判本职技能。
BRANCH_ALIAS = {
    # 格斗
    "斗殴": ("fighting", "斗殴"), "鞭": ("fighting", "鞭子"), "鞭子": ("fighting", "鞭子"),
    "链锯": ("fighting", "电锯"), "电锯": ("fighting", "电锯"), "斧": ("fighting", "斧"),
    "剑": ("fighting", "剑"), "矛": ("fighting", "矛"), "绞具": ("fighting", "绞具"),
    "链枷": ("fighting", "链枷"),
    # 射击
    "手枪": ("firearms", "手枪"), "来复枪": ("firearms", "步枪/霰弹枪"),
    "步枪": ("firearms", "步枪/霰弹枪"), "霰弹枪": ("firearms", "步枪/霰弹枪"),
    "步枪/霰弹枪": ("firearms", "步枪/霰弹枪"), "冲锋枪": ("firearms", "冲锋枪"),
    "弓术": ("firearms", "弓术"), "机枪": ("firearms", "机枪"), "重武器": ("firearms", "重武器"),
    "喷射器": ("firearms", "喷射器"),
    # 外语
    "拉丁语": ("language", "拉丁语"), "拉丁文": ("language", "拉丁语"),
    "古希腊语": ("language", "古希腊语"), "法语": ("language", "法语"),
    "德语": ("language", "德语"), "西班牙语": ("language", "西班牙语"),
    "意大利语": ("language", "意大利语"), "俄语": ("language", "俄语"),
    "阿拉伯语": ("language", "阿拉伯语"), "希伯来语": ("language", "希伯来语"),
    "汉语": ("language", "汉语"), "中文": ("language", "汉语"),
    "日语": ("language", "日语"), "梵语": ("language", "梵语"),
    "古英语": ("language", "古英语"), "英语": ("language", "英语"),
    # 科学
    "数学": ("science", "数学"), "天文": ("science", "天文学"), "天文学": ("science", "天文学"),
    "物理": ("science", "物理学"), "物理学": ("science", "物理学"), "化学": ("science", "化学"),
    "生物": ("science", "生物学"), "生物学": ("science", "生物学"),
    "地质": ("science", "地质学"), "地质学": ("science", "地质学"),
    "动物学": ("science", "动物学"), "植物学": ("science", "植物学"),
    "制药": ("science", "药学"), "药学": ("science", "药学"), "药剂学": ("science", "药学"),
    "工程学": ("science", "工程学"), "司法科学": ("science", "司法科学"),
    "气象学": ("science", "气象学"),
    # 技艺 / 艺术及手艺
    "表演": ("art", "表演"), "摄影": ("art", "摄影"), "写作": ("art", "写作"),
    "文学": ("art", "写作"), "绘画": ("art", "绘画"), "书法": ("art", "书法"),
    "烹饪": ("art", "烹饪"), "木工": ("art", "木工"), "木匠": ("art", "木工"),
    "理发": ("art", "理发"), "裁缝": ("art", "裁缝"), "歌唱": ("art", "歌唱"),
    "演唱": ("art", "歌唱"), "乐器": ("art", "乐器"), "舞蹈": ("art", "舞蹈"),
    "焊接": ("art", "焊接"), "机械制图": ("art", "机械制图"), "技术制图": ("art", "机械制图"),
    "伪造": ("art", "伪造"), "园艺": ("art", "园艺"), "管道工": ("art", "管道工"),
    "耕作": ("art", "耕作"), "打字": ("art", "打字"), "速记": ("art", "速记"),
    "游戏": ("art", "游戏"), "杂技": ("art", "杂技"), "喜剧": ("art", "喜剧"),
    # 驾驶
    "飞行器": ("drive", "飞行器"), "船": ("drive", "船"), "小艇": ("drive", "船"),
    "马车": ("drive", "马车"), "自行车": ("drive", "自行车"), "热气球": ("drive", "热气球"),
    # 生存
    "沙漠": ("survival", "沙漠"), "海上": ("survival", "海洋"), "海洋": ("survival", "海洋"),
    "极地": ("survival", "极地"), "丛林": ("survival", "丛林"), "山地": ("survival", "山地"),
    "城市": ("survival", "城市"), "沼泽": ("survival", "沼泽"),
    # 学识
    "神话学": ("lore", "神话学"), "民间传说": ("lore", "民间传说"), "地方志": ("lore", "地方志"),
    "家谱学": ("lore", "家谱学"), "佛教": ("lore", "佛教"), "神道教": ("lore", "神道教"),
    "道教": ("lore", "道教"), "阴阳道": ("lore", "阴阳道"),
}
# 「任选/举例/类似」这类词不能当成分支名
BRANCH_NOISE_RE = re.compile(r"(任|另|等|如|类似|多种|若干|母语|其他|相关|领域)")


def norm_branch(group, name):
    """原文分支名 -> SPEC_OPTIONS 里的规范写法；无法识别返回 None"""
    n = re.sub(r"\s+", "", str(name or "")).strip("。．,，、;；:：")
    if not n or BRANCH_NOISE_RE.search(n):
        return None
    hit = BRANCH_ALIAS.get(n)
    if hit and hit[0] == group:
        return hit[1]
    if n in SPEC_OPTIONS.get(group, []):
        return n
    return None


# 职业文本 -> 技能键 的同义词表
ALIAS = {
    "图书馆": "library",
    "自然": "naturalWorld",
    "博物学": "naturalWorld",
    "射击": "firearms",
    "格斗": "fighting",
    "技艺": "art",
    "手艺": "art",
    "外语": "language",
    "其他语言": "language",
    "语言": "language",
    "科学": "science",
    "驾驶": "drive",
    "汽车驾驶": "driveAuto",
    "驾驶（汽车）": "driveAuto",
    "生存": "survival",
    "学识": "lore",
    "信用评级": "credit",
    "克苏鲁神话": "cthulhu",
    "闪避": "dodge",
    "母语": "ownLanguage",
    "侦查": "spotHidden",
    "侦察": "spotHidden",
    "聆听": "listen",
    "潜行": "stealth",
    "隐匿": "stealth",
    "心理学": "psychology",
    "精神分析": "psychoanalysis",
    "魅惑": "charm",
    "取悦": "charm",
    "话术": "fastTalk",
    "说服": "persuade",
    "恐吓": "intimidate",
    "会计": "accounting",
    "人类学": "anthropology",
    "估价": "appraise",
    "考古学": "archaeology",
    "攀爬": "climb",
    "计算机使用": "computer",
    "计算机": "computer",
    "乔装": "disguise",
    "电气维修": "elecRepair",
    "电子学": "electronics",
    "急救": "firstAid",
    "历史": "history",
    "跳跃": "jump",
    "法律": "law",
    "锁匠": "locksmith",
    "机械维修": "mechRepair",
    "医学": "medicine",
    "导航": "navigate",
    "神秘学": "occult",
    "操作重型机械": "opHeavyMachine",
    "重型机械": "opHeavyMachine",
    "骑术": "ride",
    "妙手": "sleightOfHand",
    "游泳": "swim",
    "投掷": "throw",
    "追踪": "track",
    "驯兽": "animalHandling",
    "潜水": "diving",
    "爆破": "demolitions",
    "读唇": "lipReading",
    "催眠": "hypnosis",
    "炮术": "artillery",
    "攀登": "climb",
    "跳越": "jump",
    "会计学": "accounting",
    # —— 常见变体与专攻名（出现在括号、或选项里）
    "骑乘": "ride",
    "骑术": "ride",
    "艺术": "art",
    "艺术/工艺": "art",
    "艺术及手艺": "art",
    "杂技": "art",
    "重型机械操作": "opHeavyMachine",
    "自行车驾驶": "drive",
    "马车驾驶": "drive",
    "船": "drive",
    "小艇": "drive",
    "热气球": "drive",
    "飞行器": "drive",
    "斗殴": "fighting",
    "来复枪": "firearms",
    "手枪": "firearms",
    "鞭": "fighting",
    "考古": "archaeology",
    "拉丁语": "language",
}
# 括号内出现的专攻名 -> 所属专攻组
SPEC_NAME_TO_GROUP = {
    "表演": "art", "摄影": "art", "书法": "art", "写作": "art", "文学": "art", "歌唱": "art",
    "演唱": "art", "舞蹈": "art", "乐器": "art", "烹饪": "art", "裁缝": "art", "理发": "art",
    "焊接": "art", "管道工": "art", "钳工": "art", "电工": "art", "绘画": "art", "木工": "art",
    "斗殴": "fighting", "鞭子": "fighting", "斧": "fighting", "剑": "fighting", "矛": "fighting",
    "手枪": "firearms", "步枪/霰弹枪": "firearms", "冲锋枪": "firearms", "弓术": "firearms",
    "数学": "science", "天文": "science", "物理": "science", "化学": "science", "生物": "science",
    "生物学": "science", "植物学": "science", "地质": "science", "动物学": "science",
    "药学": "science", "药剂学": "science", "制药": "science", "司法科学": "science",
    "工程学": "science", "地理": "science",
}
CN2KEY = {cn: key for (key, cn, *_rest) in SKILLS}
KEY2CN = {key: cn for (key, cn, *_rest) in SKILLS}
KEY2BASE = {key: base for (key, _cn, base, *_r) in SKILLS}
SPEC_OF = {key: spec for (key, _cn, _b, _c, spec, _f) in SKILLS if spec}

SOCIAL = ["charm", "fastTalk", "intimidate", "persuade"]
CN_NUM = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6}
NUM_RE = re.compile(r"([一二两三四五六\d]+)\s*(?:项|个|种|门|类|领域|专业|技能|特长|专长)")
PLACEHOLDER_RE = re.compile(r"^(任一|任意|任意[一二两三四五六\d]+项?|等|其他|若干|某[一二三四]?项?)$")

UNMAPPED = {}


def split_top(text, seps="，,、；;"):
    """按分隔符切分，但忽略括号内部的（「一项社交技能（取悦、话术、恐吓、说服）」不能被切开）"""
    out, cur, depth = [], [], 0
    for ch in text:
        if ch in "（(《":
            depth += 1
        elif ch in "）)»":
            depth = max(0, depth - 1)
        if ch in seps and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return [x.strip() for x in out if x.strip()]


def pick_num(text, default=1):
    m = NUM_RE.search(text)
    if not m:
        return default
    tok = m.group(1)
    return int(tok) if tok.isdigit() else CN_NUM.get(tok, default)


def norm_key(tok):
    """单个技能名 -> 技能键（None 表示无法识别）"""
    t = re.sub(r"\s+", "", tok.strip().strip("。．,，、;；:："))
    if not t:
        return None
    if t in ALIAS:
        return ALIAS[t]
    if t in CN2KEY:
        return CN2KEY[t]
    base = re.sub(r"[（(].*?[)）]", "", t).strip()
    if base in ALIAS:
        return ALIAS[base]
    if base in CN2KEY:
        return CN2KEY[base]
    return None


def parse_occ_skills(text):
    """解析「本职技能」文本 -> {keys, choices, social, free, presets, unknown}

    presets 记录官方**指定的专攻方向**（例：外语（拉丁文）→ language: ["拉丁语"]、
    牧师本职里的「拉丁语」、警察的「格斗（斗殴）」）。只保留能对上 SPEC_OPTIONS 的
    规范分支名，供编辑器提示与 KP 审卡核对；识别不了的原文仍会随 skillText 一起保留。
    """
    res = {"keys": [], "choices": [], "social": 0, "free": 0, "presets": {}, "unknown": []}
    if not text:
        return res
    txt = str(text).replace("\n", " ").replace("※", " ").strip()

    def add_branch(key, group, raw_name):
        """记录一个指定分支（去噪 + 规范化；不合法就丢弃）"""
        nm = re.sub(r"^(任一|任意|任二|任选)[:：]?", "", str(raw_name or "")).strip()
        b = norm_branch(group, nm)
        if not b:
            return False
        res["presets"].setdefault(key, [])
        if b not in res["presets"][key]:
            res["presets"][key].append(b)
        return True

    def branch_candidates(inner):
        """把括号内容拆成候选分支名（含「表演类，如表演、演唱、喜剧等」的展开）"""
        names = [x.strip() for x in split_top(inner, "，,、/和")]
        if "或" in inner:
            names += [x.strip() for x in split_top(inner, "或") if x.strip() not in names]
        out = []
        for nm in names:
            if "如" in nm:
                out.extend(x.strip() for x in split_top(nm.split("如", 1)[1], "，,、/和或"))
            else:
                out.append(nm)
        return [x for x in out if x]

    for tok in split_top(txt):
        t = tok.strip().strip("。．")
        if not t:
            continue

        # 1) 纯数量描述：任意/任选 N 项其他特长、研究领域相关技能……
        if re.match(r"^(任意|任选|下面任选|以及从以下|以及从以下任选|其他|其他任何|三项|两项|一项|四项|三个|两项研究)", t) \
                and not re.search(r"[（(]", t):
            if "社交技能" in t:
                res["social"] += pick_num(t)
            else:
                res["free"] += pick_num(t)
            continue

        # 2) 「一项社交技能（取悦、话术、恐吓、说服）」
        if "社交技能" in t:
            res["social"] += pick_num(t, 1)
            continue

        # 3) 带替代表述：任选/可选
        if re.search(r"(可以用|可用).{0,6}替换", t):
            res["free"] += 1
            continue

        # 4) 顶层「或」：同一技能的不同分支算一个技能，否则视为任选其一
        alts = split_top(t, "或")
        if len(alts) > 1:
            group, ok, branches = [], True, {}
            for a in alts:
                hit = BRANCH_ALIAS.get(re.sub(r"\s+", "", a))
                k = SPEC_GROUP_KEY.get(hit[0]) if hit else None
                if hit and k:
                    branches.setdefault(k, []).append(hit[1])
                else:
                    k = norm_key(a)
                    if k is None:
                        ok = False
                        break
                if k not in group:
                    group.append(k)
            if ok and group:
                if len(group) == 1 and group[0] in branches:
                    res["keys"].append(group[0])
                    for b in branches[group[0]]:
                        add_branch(group[0], SPEC_OF[group[0]], b)
                else:
                    res["keys"].extend(group)          # 这些技能都算本职范畴
                    res["choices"].append(group)       # 但只需任选其一
            continue

        # 5) 「技艺（表演）」「科学（生物学，化学）」：主体 + 括号内预设
        pm = re.match(r"^([^（(]*)[（(](.+?)[)）]\s*(?:中的一种|其中之一|中的一项|任选其一)?\s*$", t)
        if pm:
            head, inner = pm.group(1).strip(), pm.group(2).strip()
            if not head:
                # 整句被括号包住：「（乔装、钳工）中的一种」→ 任选其一
                group = []
                for a in split_top(inner, "，,、/或"):
                    k = norm_key(a) or SPEC_NAME_TO_GROUP.get(a)
                    if k and k not in group:
                        group.append(k)
                if group:
                    res["keys"].extend(group)
                    res["choices"].append(group)
                    continue
            head_keys, key = [], norm_key(head)
            if key:
                head_keys = [key]
            elif "或" in head:
                # 「汽车驾驶或驾驶（飞行器或船）」：主体本身就是两个技能
                for part in split_top(head, "或"):
                    pk = norm_key(part)
                    if pk:
                        head_keys.append(pk)
                key = next((k for k in head_keys if k in SPEC_OF), head_keys[0] if head_keys else None)
            if head_keys:
                res["keys"].extend(head_keys)
                if key in SPEC_OF:
                    for nm in branch_candidates(inner):
                        add_branch(key, SPEC_OF[key], nm)
                if key == "science":
                    res["keys"].append(key)
                continue

        # 6) 普通技能名（也可能是具体分支：拉丁语 / 斗殴 / 来复枪）
        hit = BRANCH_ALIAS.get(re.sub(r"\s+", "", t))
        if hit:
            gk = SPEC_GROUP_KEY.get(hit[0])
            if gk:
                res["keys"].append(gk)
                add_branch(gk, hit[0], hit[1])
                continue
        key = norm_key(t)
        if key:
            res["keys"].append(key)
            continue

        # 7) 兜底：容忍「研究领域相关技能」之类的自由描述
        if re.search(r"(技能|特长|专长|领域|专业|任选|其他|等)", t):
            res["free"] += pick_num(t)
            continue

        res["unknown"].append(t)
        UNMAPPED[t] = UNMAPPED.get(t, 0) + 1

    # 去重连续重复项，保留「科学×2」这类刻意重复
    seen, keys = {}, []
    for k in res["keys"]:
        seen[k] = seen.get(k, 0) + 1
        keys.append(k)
    res["keys"] = keys
    return res


POINT_RE = re.compile(r"(EDU|INT|STR|DEX|APP|POW|CON|SIZ)\s*\*\s*(\d+)")
MAX_RE = re.compile(r"MAX\(([^)]*)\)")


def parse_points(formula):
    """=EDU*2+MAX(STR*2,DEX*2) -> {'terms':[{stat,mult}],'max':[{stat,mult}]}"""
    if not formula or not isinstance(formula, str):
        return None
    f = formula.lstrip("=")
    mm = MAX_RE.search(f)
    max_terms = []
    if mm:
        for part in mm.group(1).split(","):
            m2 = POINT_RE.search(part)
            if m2:
                max_terms.append({"stat": m2.group(1), "mult": int(m2.group(2))})
        f = MAX_RE.sub("", f)
    terms = [{"stat": m.group(1), "mult": int(m.group(2))} for m in POINT_RE.finditer(f)]
    if not terms and not max_terms:
        return None
    return {"terms": terms, "max": max_terms}


def js(obj, indent=0):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def main():
    xlsx = sys.argv[1] if len(sys.argv) > 1 else None
    if not xlsx or not os.path.exists(xlsx):
        print("usage: gen-coc7e-data.py <xlsx>")
        return 1
    wb = openpyxl.load_workbook(xlsx, data_only=False)
    ws = wb["职业列表"]

    occs = []
    for r in range(3, 300):
        name = ws.cell(row=r, column=2).value
        if name is None or (isinstance(name, str) and name.startswith("=")):
            continue
        credit = ws.cell(row=r, column=4).value
        attr = ws.cell(row=r, column=5).value
        pts = ws.cell(row=r, column=6).value
        skills_txt = ws.cell(row=r, column=7).value
        note_txt = ws.cell(row=r, column=8).value
        desc = ws.cell(row=r, column=13).value
        parsed = parse_occ_skills("" if skills_txt is None else str(skills_txt))
        pts_spec = parse_points(pts)
        cr = re.findall(r"\d+", str(credit) if credit is not None else "")
        short = ""
        if desc:
            short = re.split(r"[。\n]", str(desc).strip())[0]
            if len(short) > 72:
                short = short[:70] + "…"
        # 本职技能原文（Excel 原样保留，供玩家与 KP 对照；压掉换行并限长）
        skill_text = re.sub(r"\s+", " ", str(skills_txt or "")).strip().rstrip("。")
        if len(skill_text) > 220:
            skill_text = skill_text[:218] + "…"
        # 备注栏只取真正的规则备注（过滤掉表头附近的下拉说明文字）
        note = ""
        if note_txt and re.search(r"(仅限|使用前请征得\s*KP\s*同意)", str(note_txt)):
            note = re.sub(r"\s+", " ", str(note_txt)).strip()
        occs.append({
            "id": int(ws.cell(row=r, column=1).value or 0),
            "name": str(name).strip(),
            "cr": [int(cr[0]), int(cr[1])] if len(cr) >= 2 else [0, 99],
            "attr": None if attr is None else str(attr).strip(),
            "pts": pts_spec,
            "keys": parsed["keys"],
            "choices": parsed["choices"],
            "social": parsed["social"],
            "free": parsed["free"],
            "presets": {k: v for k, v in parsed["presets"].items() if v},
            "desc": short,
            "skillText": skill_text,
            "note": note,
        })

    # ------------------------------------------------ 抽取武器表
    wsw = wb['武器列表 战斗']
    weapons = []
    for r in range(2, 400):
        name = wsw.cell(row=r, column=2).value
        if name is None or str(name).strip() == '':
            break
        def cv(c):
            v = wsw.cell(row=r, column=c).value
            return '' if v is None else str(v).strip()
        era_txt = cv(10)
        weapons.append({
            "name": str(name).strip(),
            "skill": cv(3),
            "damage": cv(4),
            "range": cv(5),
            "attacks": cv(7),
            "ammo": cv(8),
            "malfunction": cv(9),
            "eras": [e for e in ['1920s', '现代', '罕见'] if e in era_txt],
        })
    # 规则书里的「徒手攻击」不在武器表内，单独补一条并强制常驻
    weapons.insert(0, {
        "name": "徒手", "skill": "斗殴", "damage": "1D3+DB", "range": "接触",
        "attacks": "1", "ammo": "——", "malfunction": "——", "eras": ["1920s", "现代"], "builtin": True,
    })

    # ------------------------------------------------ 输出：共享参考数据
    # 前端与后端共用同一份参考数据（后端用于权威校验，前端用于实时计算与展示）
    lines = []
    lines.append("// 本文件由 tools/gen-coc7e-data.py 从《COC七版规则空白卡CY21.1.xlsx》生成，请勿手改。")
    lines.append("// 前端(实时计算/展示)与后端(权威校验)共用；规则算法见 shared/coc7e.js。")
    lines.append("")
    lines.append("/** 技能表：key 内部键名，name 中文名，base 基础值(null=按公式)，cat 分类，flags 特殊标记 */")
    lines.append("export const SKILLS = [")
    for (key, cn, base, cat, spec, flag) in SKILLS:
        lines.append("  { key: %s, name: %s, base: %s, cat: %s%s%s }," % (
            js(key), js(cn), "null" if base is None else base, js(cat),
            (", spec: " + js(spec)) if spec else "",
            (", flags: " + js(flag.split(","))) if flag else ""))
    lines.append("];")
    lines.append("")
    lines.append("export const SKILL_BY_KEY = Object.fromEntries(SKILLS.map(s => [s.key, s]));")
    lines.append("export const SKILL_BY_NAME = Object.fromEntries(SKILLS.map(s => [s.name, s]));")
    lines.append("")
    lines.append("/** 专攻组预设：预设名 -> 覆盖后的基础值（未列出者用该技能的基础值） */")
    lines.append("export const SPEC_PRESETS = %s;" % js(SPEC_PRESETS))
    lines.append("")
    lines.append("/** 专攻组的下拉可选项（供编辑器选择；空专攻槽位不会被打印） */")
    lines.append("export const SPEC_OPTIONS = %s;" % js(SPEC_OPTIONS))
    lines.append("")
    lines.append("/** 每个专攻组的槽位数（对齐官方纸质角色卡版面） */")
    lines.append("export const SPEC_SLOTS = %s;" % js(SPEC_SLOTS))
    lines.append("")
    lines.append("/** 社交技能组：职业的「任选 N 项社交技能」从这里挑 */")
    lines.append("export const SOCIAL_SKILLS = %s;" % js(SOCIAL))
    lines.append("")
    lines.append("/** %d 条 COC 7e 职业。keys 固定本职；choices 任选其一组；social/free 可自由指定的本职槽位数；"
                 "presets 为官方指定的专攻方向（如 外语→拉丁语）；skillText 为本职技能原文、note 为官方备注 */" % len(occs))
    lines.append("export const OCCUPATIONS = [")
    for o in occs:
        lines.append("  { id: %d, name: %s, cr: [%d, %d], attr: %s, pts: %s, keys: %s, choices: %s, social: %d, free: %d, presets: %s, desc: %s, skillText: %s, note: %s }," % (
            o["id"], js(o["name"]), o["cr"][0], o["cr"][1], js(o["attr"]), js(o["pts"]),
            js(o["keys"]), js(o["choices"]), o["social"], o["free"], js(o["presets"]), js(o["desc"]),
            js(o["skillText"]), js(o["note"])))
    lines.append("];")
    lines.append("")
    lines.append("export const OCCUPATION_BY_ID = Object.fromEntries(OCCUPATIONS.map(o => [o.id, o]));")
    lines.append("")
    lines.append("/** %d 条武器（来自官方武器表；第一条「徒手」为常驻项，不可删除） */" % len(weapons))
    lines.append("export const WEAPONS = [")
    for w in weapons:
        lines.append("  { name: %s, skill: %s, damage: %s, range: %s, attacks: %s, ammo: %s, malfunction: %s, eras: %s%s }," % (
            js(w["name"]), js(w["skill"]), js(w["damage"]), js(w["range"]), js(w["attacks"]),
            js(w["ammo"]), js(w["malfunction"]), js(w["eras"]),
            ", builtin: true" if w.get("builtin") else ""))
    lines.append("];")
    lines.append("")
    lines.append("export const WEAPON_BY_NAME = Object.fromEntries(WEAPONS.map(w => [w.name, w]));")
    lines.append("export const OCCUPATION_BY_NAME = Object.fromEntries(OCCUPATIONS.map(o => [o.name, o]));")
    lines.append("")
    out_path = os.path.join(ROOT, "shared", "coc7e-reference.js")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    report = ["occupations: %d" % len(occs),
              "distinct unmapped tokens: %d" % len(UNMAPPED), ""]
    for k, v in sorted(UNMAPPED.items(), key=lambda x: (-x[1], x[0])):
        report.append("  x%-4d %s" % (v, k))
    report_path = os.environ.get("COC_REPORT", os.path.join(ROOT, "tools", "_unmapped.txt"))
    with open(report_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(report))
    print("occupations: %d ; unmapped: %d ; report -> %s" % (len(occs), len(UNMAPPED), report_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
