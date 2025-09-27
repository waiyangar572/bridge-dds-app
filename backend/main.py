from ctypes import byref

# dds.pyが同じディレクトリにあるDLLを自動的に読み込みます
import dds
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, constr

app = FastAPI()

# CORSミドルウェアを追加
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DealPBN(BaseModel):
    pbn: constr(max_length=80)


@app.get("/")
def read_root():
    return {"message": "DDS Analysis Server is running"}


@app.post("/api/analyse")
def analyse_deal(deal_pbn: DealPBN):
    # PBNを直接扱える構造体を使用
    table_deal_pbn = dds.ddTableDealPBN()
    table_deal_pbn.cards = deal_pbn.pbn.encode("utf-8")

    # 結果を格納する構造体
    results = dds.ddTableResults()

    # Cの関数を呼び出し。第二引数はポインタ（参照渡し）として渡す
    ret = dds.CalcDDtablePBN(table_deal_pbn, byref(results))

    if ret != dds.RETURN_NO_FAULT:
        return {"error": f"DDS library failed with return code: {ret}"}

    # 結果をJSONレスポンス用に整形
    # dds.pyで定義されている定数を使って、可読性と正確性を高める

    # フロントエンドが期待する順番
    display_suits = [
        "No-Trump",
        "Clubs",
        "Diamonds",
        "Hearts",
        "Spades",
    ]

    # dds.py内のスートのインデックス定義
    suit_map = {
        "Spades": dds.SUIT_SPADE,
        "Hearts": dds.SUIT_HEART,
        "Diamonds": dds.SUIT_DIAMOND,
        "Clubs": dds.SUIT_CLUB,
        "No-Trump": dds.SUIT_NT,
    }

    # dds.py内のハンドのインデックス定義
    hand_map = {
        "North": dds.HAND_NORTH,
        "South": dds.HAND_SOUTH,
        "East": dds.HAND_EAST,
        "West": dds.HAND_WEST,
    }

    response_data = {"tricks": {}}

    # resTableのアクセス順を [hand][suit] に修正
    for suit_name in display_suits:
        suit_idx = suit_map[suit_name]
        response_data["tricks"][suit_name] = {
            "North": results.resTable[suit_idx][hand_map["North"]],
            "East": results.resTable[suit_idx][hand_map["East"]],
            "South": results.resTable[suit_idx][hand_map["South"]],
            "West": results.resTable[suit_idx][hand_map["West"]],
        }

    return response_data
