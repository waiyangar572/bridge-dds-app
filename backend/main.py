import random
from ctypes import byref, create_string_buffer

# dds.pyが同じディレクトリにあるDLLを自動的に読み込みます
import dds
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, constr

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


class SingleDummyRequest(BaseModel):
    pbn: constr(max_length=80)
    simulations: int = Field(default=1000, ge=1, le=10000)


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

    # resTableのアクセス順を [suit][hand] に修正
    for suit_name in display_suits:
        suit_idx = suit_map[suit_name]
        response_data["tricks"][suit_name] = {
            "North": results.resTable[suit_idx][hand_map["North"]],
            "East": results.resTable[suit_idx][hand_map["East"]],
            "South": results.resTable[suit_idx][hand_map["South"]],
            "West": results.resTable[suit_idx][hand_map["West"]],
        }

    return response_data


@app.post("/api/analyse_single_dummy")
def analyse_single_dummy(request: SingleDummyRequest):
    try:
        # PBNからN/Sのハンドをパース
        pbn_parts = request.pbn[2:].split()
        north_hand_str = pbn_parts[0]
        south_hand_str = pbn_parts[2]

        # 残りのカード（E/Wのカード）を特定
        all_ranks = "AKQJT98765432"
        remaining_cards = []
        # 各スートについて処理
        for suit_idx in range(4):
            north_suit = north_hand_str.split(".")[suit_idx]
            south_suit = south_hand_str.split(".")[suit_idx]
            ns_suit_cards = set(north_suit) | set(south_suit)

            for rank in all_ranks:
                if rank not in ns_suit_cards:
                    # Sort ranks for consistency, simplifies testing/debugging
                    rank_order = all_ranks.find(rank)
                    remaining_cards.append((suit_idx, rank_order, rank))

        if len(remaining_cards) != 26:
            return {
                "error": "Invalid number of cards for North and South. Must be 26 total."
            }

        # 平均トリック数計算のための準備
        total_tricks = {
            dds.SUIT_NT: {"North": 0, "South": 0},
            dds.SUIT_SPADE: {"North": 0, "South": 0},
            dds.SUIT_HEART: {"North": 0, "South": 0},
            dds.SUIT_DIAMOND: {"North": 0, "South": 0},
            dds.SUIT_CLUB: {"North": 0, "South": 0},
        }

        num_simulations = request.simulations

        for i in range(num_simulations):
            # E/Wのハンドをランダムに生成
            random.shuffle(remaining_cards)
            east_cards = sorted(remaining_cards[:13])
            west_cards = sorted(remaining_cards[13:])

            east_hand = ["", "", "", ""]
            west_hand = ["", "", "", ""]
            for suit, _, rank in east_cards:
                east_hand[suit] += rank
            for suit, _, rank in west_cards:
                west_hand[suit] += rank

            # Sort ranks within each suit string
            east_hand = [
                "".join(sorted(s, key=lambda x: all_ranks.find(x)))
                for s in east_hand
            ]
            west_hand = [
                "".join(sorted(s, key=lambda x: all_ranks.find(x)))
                for s in west_hand
            ]

            east_hand_str = ".".join(s if s else "-" for s in east_hand)
            west_hand_str = ".".join(s if s else "-" for s in west_hand)

            # 完全なPBNを構築
            full_pbn = f"N:{north_hand_str} {east_hand_str} {south_hand_str} {west_hand_str}"

            # DDSで解析
            table_deal_pbn = dds.ddTableDealPBN()
            table_deal_pbn.cards = full_pbn.encode("utf-8")
            results = dds.ddTableResults()
            ret = dds.CalcDDtablePBN(table_deal_pbn, byref(results))

            if ret == dds.RETURN_NO_FAULT:
                for suit_idx in total_tricks:
                    total_tricks[suit_idx]["North"] += results.resTable[
                        suit_idx
                    ][dds.HAND_NORTH]
                    total_tricks[suit_idx]["South"] += results.resTable[
                        suit_idx
                    ][dds.HAND_SOUTH]
            else:
                # Handle error for a single simulation if necessary, e.g., log it
                # For now, we'll just skip this result from the average
                if (
                    i == 0
                ):  # Only return error on the first try to avoid spamming
                    return {
                        "error": f"DDS failed on simulation with PBN: {full_pbn}"
                    }

        # 平均を計算
        avg_tricks = {}
        suit_map_rev = {
            dds.SUIT_SPADE: "Spades",
            dds.SUIT_HEART: "Hearts",
            dds.SUIT_DIAMOND: "Diamonds",
            dds.SUIT_CLUB: "Clubs",
            dds.SUIT_NT: "No-Trump",
        }
        for suit_idx, hands in total_tricks.items():
            suit_name = suit_map_rev[suit_idx]
            avg_tricks[suit_name] = {
                "North": (
                    hands["North"] / num_simulations
                    if num_simulations > 0
                    else 0
                ),
                "South": (
                    hands["South"] / num_simulations
                    if num_simulations > 0
                    else 0
                ),
            }

        return {
            "average_tricks": avg_tricks,
            "simulations_run": num_simulations,
        }

    except Exception as e:
        return {
            "error": f"An error occurred during single dummy analysis: {str(e)}"
        }
