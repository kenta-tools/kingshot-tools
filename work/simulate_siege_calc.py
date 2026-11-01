# -*- coding: utf-8 -*-
# 炎龍の覇者_攻城タイムライン計算.html の runCalculation() をPythonに忠実移植してデバッグする
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

kezuriRally = 5 * 60
mainRally = 3 * 60
gap = 1
buffer = 30
rounds = 2

members = [
    {"id": "main1", "role": "メイン", "label": "じゃが", "march": 52},
    {"id": "k1", "role": "削り", "label": "あるた", "march": 53},
    {"id": "k2", "role": "削り", "label": "じろ", "march": 86},
    {"id": "k3", "role": "削り", "label": "HIMMEL", "march": 58},
    {"id": "k4", "role": "削り", "label": "かむ", "march": 40},
    {"id": "k5", "role": "削り", "label": "みつばち", "march": 71},
    {"id": "k6", "role": "削り", "label": "にゃんこ", "march": 60},
    {"id": "k7", "role": "削り", "label": "kenta", "march": 55},
]
patterns = [
    {"id": "p1", "name": "①", "kezuriIds": {"k1", "k2"}},
    {"id": "p2", "name": "②", "kezuriIds": {"k3", "k4"}},
    {"id": "p3", "name": "③", "kezuriIds": {"k5", "k6", "k7"}},
]

mainMembers = [m for m in members if m["role"] == "メイン"]
reinforceMembers = [m for m in members if m["role"] == "増援"]

readyTime = {m["id"]: 0 for m in members}

instances = []
for r in range(1, rounds + 1):
    for idx, p in enumerate(patterns):
        instances.append({"round": r, "pattern": p, "order": idx})


def kezuriOf(p):
    return [m for m in members if m["id"] in p["kezuriIds"]]


def computeMinT(inst):
    kezuri = kezuriOf(inst["pattern"])
    candidates = [0]
    for m in kezuri:
        candidates.append(readyTime[m["id"]] + kezuriRally + m["march"])
    for m in mainMembers:
        candidates.append(readyTime[m["id"]] + mainRally + m["march"] - gap)
    for m in reinforceMembers:
        candidates.append(readyTime[m["id"]] + mainRally + m["march"] - gap * 2)
    return max(candidates)


results = []

for step, inst in enumerate(instances, start=1):
    T = computeMinT(inst)
    kezuri = kezuriOf(inst["pattern"])
    lines = []
    for m in kezuri:
        arrival = T
        launch = arrival - kezuriRally - m["march"]
        ret = arrival + m["march"]
        readyTime[m["id"]] = ret + buffer
        lines.append({"label": m["label"], "role": "削り", "rallyDur": kezuriRally, "launch": launch, "arrival": arrival, "ret": ret})
    for m in mainMembers:
        arrival = T + gap
        launch = arrival - mainRally - m["march"]
        ret = arrival + m["march"]
        readyTime[m["id"]] = ret + buffer
        lines.append({"label": m["label"], "role": "メイン", "rallyDur": mainRally, "launch": launch, "arrival": arrival, "ret": ret})
    for m in reinforceMembers:
        arrival = T + gap * 2
        launch = arrival - mainRally - m["march"]
        ret = arrival + m["march"]
        readyTime[m["id"]] = ret + buffer
        lines.append({"label": m["label"], "role": "増援", "rallyDur": mainRally, "launch": launch, "arrival": arrival, "ret": ret})

    results.append({"round": inst["round"], "pattern": inst["pattern"], "T": T, "lines": lines})
    print(f'step{step}: round={inst["round"]} pattern={inst["pattern"]["name"]} T={T} labels={[l["label"] for l in lines]}')


def fmt(sec):
    sec = round(sec)
    return f'{sec//60}分{sec%60:02d}秒'


print("\n=== 1周目 表示 ===")
for p in patterns:
    res = next(r for r in results if r["round"] == 1 and r["pattern"]["id"] == p["id"])
    kezuri_labels = "+".join(m["label"] for m in kezuriOf(p))
    print(f'{p["name"]}{kezuri_labels}→メイン→増援')
    for line in res["lines"]:
        march = line["arrival"] - line["launch"] - line["rallyDur"]
        print(f'  {fmt(line["launch"])} → {line["label"]}（{line["rallyDur"]//60}分集結） ※行軍{march}秒 （{fmt(line["arrival"])}着、{fmt(line["ret"])}帰還）  [role={line["role"]}]')
