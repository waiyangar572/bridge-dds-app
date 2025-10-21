import json
import math
import os
import random
import re
import subprocess
import time
from ctypes import byref, c_int
from typing import Dict, List, Optional, Tuple

import dds
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, constr

app = FastAPI()

origins = [
    "https://bridge-analyzer.web.app",
    "http://localhost",
    "http://localhost:8080",
    "http://127.0.0.1:5500",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DealPBN(BaseModel):
    pbn: constr(max_length=80)


class SingleDummyRequest(BaseModel):
    pbn: constr(max_length=80)
    advanced_tcl: Optional[str] = ""
    simulations: int = Field(default=1000, ge=1, le=5000)


class LeadSolverRequest(BaseModel):
    leader_hand_pbn: str
    shapes: Dict[str, str]
    hcp: Dict[str, str]
    contract: str
    leader: str
    simulations: int = Field(default=1000, ge=10, le=5000)
    advanced_tcl: Optional[str] = ""


@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    try:
        response = await call_next(request)
        return response
    except Exception as e:
        # Return a JSON response with CORS headers when an unhandled error occurs
        return JSONResponse(
            status_code=500,
            content={
                "error": f"An unexpected server error occurred: {str(e)}"
            },
        )


# PBN文字列のリストを渡すと、各ディールの解決済みのトリックを返す
# 例: ["N:...", "N:..."] -> [[...], [...]]
def solve_multiple_deals_in_batch(pbn_deals):
    num_deals = len(pbn_deals)
    if num_deals == 0:
        return []

    # 複数のディールを格納するための構造体を準備
    bo = dds.boardsPBN()
    bo.noOfBoards = num_deals

    # 各ディールの情報を構造体にセット
    for i, pbn_deal in enumerate(pbn_deals):
        bo.deals[i].trump = dds.SUIT_NT  # 必要に応じて変更
        bo.deals[i].first = dds.HAND_NORTH  # 必要に応じて変更
        # PBN文字列をbytesにエンコードして設定
        bo.deals[i].remainCards = pbn_deal.encode("utf-8")

    # 結果を格納する構造体を準備
    solved = dds.solvedBoards()

    # 一括処理を実行
    res = dds.SolveAllBoards(dds.pointer(bo), dds.pointer(solved))
    if res != dds.RETURN_NO_FAULT:
        print(f"DDS Error: {res}")
        return None

    # 結果をPythonのリストに変換
    results = []
    for i in range(num_deals):
        display_suits = ["No-Trump", "Clubs", "Diamonds", "Hearts", "Spades"]
        suit_map = {
            "Spades": dds.SUIT_SPADE,
            "Hearts": dds.SUIT_HEART,
            "Diamonds": dds.SUIT_DIAMOND,
            "Clubs": dds.SUIT_CLUB,
            "No-Trump": dds.SUIT_NT,
        }
        hand_map = {
            "North": dds.HAND_NORTH,
            "South": dds.HAND_SOUTH,
            "East": dds.HAND_EAST,
            "West": dds.HAND_WEST,
        }
        response_data = {"tricks": {}}
        for suit_name in display_suits:
            suit_idx = suit_map[suit_name]
            response_data["tricks"][suit_name] = {
                "North": results.resTable[suit_idx][hand_map["North"]],
                "East": results.resTable[suit_idx][hand_map["East"]],
                "South": results.resTable[suit_idx][hand_map["South"]],
                "West": results.resTable[suit_idx][hand_map["West"]],
            }
        results.append(response_data)

    return results


@app.get("/")
def read_root():
    return {"message": "DDS and Lead Solver Server is running"}


@app.post("/api/analyse")
def analyse_deal(deal_pbn: DealPBN):
    # (変更なし)
    table_deal_pbn = dds.ddTableDealPBN()
    table_deal_pbn.cards = deal_pbn.pbn.encode("utf-8")
    results = dds.ddTableResults()
    ret = dds.CalcDDtablePBN(table_deal_pbn, byref(results))
    if ret != dds.RETURN_NO_FAULT:
        return {"error": f"DDS library failed with return code: {ret}"}
    display_suits = ["No-Trump", "Clubs", "Diamonds", "Hearts", "Spades"]
    suit_map = {
        "Spades": dds.SUIT_SPADE,
        "Hearts": dds.SUIT_HEART,
        "Diamonds": dds.SUIT_DIAMOND,
        "Clubs": dds.SUIT_CLUB,
        "No-Trump": dds.SUIT_NT,
    }
    hand_map = {
        "North": dds.HAND_NORTH,
        "South": dds.HAND_SOUTH,
        "East": dds.HAND_EAST,
        "West": dds.HAND_WEST,
    }
    response_data = {"tricks": {}}
    for suit_name in display_suits:
        suit_idx = suit_map[suit_name]
        response_data["tricks"][suit_name] = {
            "North": results.resTable[suit_idx][hand_map["North"]],
            "East": results.resTable[suit_idx][hand_map["East"]],
            "South": results.resTable[suit_idx][hand_map["South"]],
            "West": results.resTable[suit_idx][hand_map["West"]],
        }
    return response_data


def runDeal(tcl_text, num):
    # Write the script to a temporary file
    script_filename = "_deal.tcl"
    print(tcl_text)
    with open(script_filename, "w") as f:
        f.write(tcl_text)

    # 2. Call the 'deal' command using the script file
    try:
        command = [
            "deal",
            "-i",
            script_filename,
            "-i",
            "format/pbn",
            str(num),
        ]
        process = subprocess.Popen(
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        stdout, stderr = process.communicate(timeout=800)

        if process.returncode != 0:
            return {"error": f"Deal command failed: {stderr}"}

        print(stdout)
        return stdout

    except FileNotFoundError:
        return {
            "error": "The 'deal' command is not found. Please ensure it is installed and in the system's PATH."
        }
    except subprocess.TimeoutExpired:
        return {
            "error": "Hand generation timed out. The constraints might be too complex or impossible to satisfy."
        }
    except Exception as e:
        return {"error": f"An error occurred during hand generation: {str(e)}"}


@app.post("/api/analyse_single_dummy")
def analyse_single_dummy(request: SingleDummyRequest):
    try:
        pbn_parts = request.pbn[2:].split()
        north_hand_str = pbn_parts[0]
        south_hand_str = pbn_parts[2]

        # all_ranks = "AKQJT98765432"
        # remaining_cards = []
        # for suit_idx in range(4):
        #     north_suit = north_hand_str.split(".")[suit_idx]
        #     south_suit = south_hand_str.split(".")[suit_idx]
        #     ns_suit_cards = set(north_suit) | set(south_suit)
        #     for rank in all_ranks:
        #         if rank not in ns_suit_cards:
        #             remaining_cards.append((suit_idx, rank))
        north_hand_tcl = (
            "{"
            + " ".join(
                part if part != "-" else '""'
                for part in north_hand_str.split(".")
            )
            + "}"
        )
        south_hand_tcl = (
            "{"
            + " ".join(
                part if part != "-" else '""'
                for part in south_hand_str.split(".")
            )
            + "}"
        )

        # if len(remaining_cards) != 26:
        #     return {
        #         "error": "Invalid number of cards for North and South. Must be 26 total."
        #     }

        trick_distribution = {
            suit: {"North": [0] * 14, "South": [0] * 14}
            for suit in [
                dds.SUIT_NT,
                dds.SUIT_SPADE,
                dds.SUIT_HEART,
                dds.SUIT_DIAMOND,
                dds.SUIT_CLUB,
            ]
        }

        # num_simulations = request.simulations
        # valid_simulations = 0

        # for _ in range(num_simulations):
        #     random.shuffle(remaining_cards)
        #     east_cards = sorted(remaining_cards[:13])
        #     west_cards = sorted(remaining_cards[13:])

        #     east_hand = [
        #         "".join(r for s, r in east_cards if s == i) for i in range(4)
        #     ]
        #     west_hand = [
        #         "".join(r for s, r in west_cards if s == i) for i in range(4)
        #     ]

        #     east_hand_str = ".".join(
        #         s if s else "-"
        #         for s in [
        #             "".join(sorted(s, key=lambda x: all_ranks.find(x)))
        #             for s in east_hand
        #         ]
        #     )
        #     west_hand_str = ".".join(
        #         s if s else "-"
        #         for s in [
        #             "".join(sorted(s, key=lambda x: all_ranks.find(x)))
        #             for s in west_hand
        #         ]
        #     )

        #     full_pbn = f"N:{north_hand_str} {east_hand_str} {south_hand_str} {west_hand_str}"

        #     table_deal_pbn = dds.ddTableDealPBN()
        #     table_deal_pbn.cards = full_pbn.encode("utf-8")
        #     results = dds.ddTableResults()
        #     ret = dds.CalcDDtablePBN(table_deal_pbn, byref(results))

        #     if ret == dds.RETURN_NO_FAULT:
        #         valid_simulations += 1
        #         for suit_idx in trick_distribution:
        #             north_tricks = results.resTable[suit_idx][dds.HAND_NORTH]
        #             south_tricks = results.resTable[suit_idx][dds.HAND_SOUTH]
        #             trick_distribution[suit_idx]["North"][north_tricks] += 1
        #             trick_distribution[suit_idx]["South"][south_tricks] += 1

        tcl_text = f"""
north is {north_hand_tcl}
south is {south_hand_tcl}
main {"{"}
{request.advanced_tcl or ""}
accept
{"}"}
        """
        deal_pbn = runDeal(tcl_text, request.simulations)
        # print(deal_pbn)
        deals = deal_pbn.splitlines()
        deals = list(filter(lambda x: x != "", deals))

        print(len(deals))
        print(deals)

        batch_num = math.ceil(len(deals) / dds.MAXNOOFBOARDS)
        all_results = []
        for batch in range(batch_num):
            table_deals_pbn = dds.ddTableDealsPBN()
            table_deals_pbn.noOfTables = (
                len(deals) - batch * dds.MAXNOOFBOARDS
                if len(deals) - batch * dds.MAXNOOFBOARDS < dds.MAXNOOFBOARDS
                else dds.MAXNOOFBOARDS
            )
            for i, pbn in enumerate(
                deals[
                    batch * dds.MAXNOOFBOARDS : (batch + 1) * dds.MAXNOOFBOARDS
                ]
            ):
                # table_deal_pbn = dds.ddTableDealPBN()
                hand = (
                    pbn.replace('[Deal "', "")
                    .replace('"]', "")
                    .replace(". ", ".- ")
                    .replace("..", ".-.")
                    .replace(" .", " -.")
                )
                print(i, hand)
                if hand != "":
                    table_deals_pbn.deals[i].cards = hand.encode("utf-8")
                    print(i)

                # deals.append(table_deal_pbn)

            results = dds.ddTablesRes()
            per_results = dds.allParResults()
            print("run calc all tables")
            ret = dds.CalcAllTablesPBN(
                table_deals_pbn,
                (c_int * 5)(0, 0, 0, 0, 0),
                0,
                byref(results),
                byref(per_results),
            )
            print(ret)
            print(results)
            print(per_results)
            if ret != dds.RETURN_NO_FAULT:
                return {"error": f"DDS library failed with return code: {ret}"}

            all_results += results

        suit_map_rev = {
            dds.SUIT_SPADE: "Spades",
            dds.SUIT_HEART: "Hearts",
            dds.SUIT_DIAMOND: "Diamonds",
            dds.SUIT_CLUB: "Clubs",
            dds.SUIT_NT: "No-Trump",
        }

        response_dist = {}
        valid_simulations = len(deal_pbn.splitlines())
        for suit_idx, hands in trick_distribution.items():
            suit_name = suit_map_rev[suit_idx]
            response_dist[suit_name] = {
                "North": [
                    (count / valid_simulations) * 100
                    for count in hands["North"]
                ],
                "South": [
                    (count / valid_simulations) * 100
                    for count in hands["South"]
                ],
            }

        return {
            "trick_distribution": response_dist,
            "simulations_run": valid_simulations,
        }

    except Exception as e:
        return {
            "error": f"An error occurred during single dummy analysis: {str(e)}"
        }


@app.post("/api/solve_lead")
def solve_opening_lead(request: LeadSolverRequest):
    aggregated_results, valid_simulations = {}, 0

    # 1. Construct the conditions for the 'deal' script file
    leader_hand_setup = ""
    other_player_conditions = []

    # Leader's hand setup using the 'is' command
    pbn_parts = request.leader_hand_pbn.split(".")
    # The format needs spaces, not dots, and no hyphens for voids. e.g., {AKQ JT9 876 ""}
    deal_hand_string = (
        "{"
        + " ".join(part if part != "-" else '""' for part in pbn_parts)
        + "}"
    )
    map = {"N": "north", "S": "south", "E": "east", "W": "west"}
    leader_hand_setup = f"{map[request.leader]} is {deal_hand_string}"

    # Other players' conditions for the 'reject' expression
    other_players = [
        p
        for p in ["north", "south", "east", "west"]
        if p != map[request.leader]
    ]

    def splitRange(range, min=0, max=40):
        if range.find("-") == -1:
            return int(range), int(range)
        else:
            [part1, part2, *_] = range.split("-")
            print(f"{part1},{part2}")
            if part1 == "":
                part1 = min
            if part2 == "":
                part2 = max

            return part1, part2

    for p in other_players:
        shape_parts = request.shapes[p].split(",")
        suits = ["spades", "hearts", "diamonds", "clubs"]
        for i, part in enumerate(shape_parts):
            min_len, max_len = splitRange(part)
            suit_name = suits[i]
            if min_len == max_len:
                other_player_conditions.append(
                    f"[{suit_name} {p}] == {min_len}"
                )
            else:
                if int(min_len) > 0:
                    other_player_conditions.append(
                        f"[{suit_name} {p}] >= {min_len}"
                    )
                if int(max_len) < 13:
                    other_player_conditions.append(
                        f"[{suit_name} {p}] <= {max_len}"
                    )

        hcp_range = splitRange(request.hcp[p])
        other_player_conditions.append(f"[hcp {p}] >= {hcp_range[0]}")
        other_player_conditions.append(f"[hcp {p}] <= {hcp_range[1]}")

    # Combine into the script file content
    boolean_expression = " && ".join(other_player_conditions)

    script_content = f"""
{leader_hand_setup}
main {"{"}
reject unless {{ {boolean_expression} }}
{request.advanced_tcl or ""}
accept
{"}"}
"""

    # 2. Call the 'deal' command using the script file
    timestamp = time.time()
    pbn_filename = f"deals{timestamp}.pbn"

    try:
        generated_pbns = runDeal(script_content, request.simulations)

        with open(pbn_filename, "w") as f:
            f.write(generated_pbns)

    except FileNotFoundError:
        return {
            "error": "The 'deal' command is not found. Please ensure it is installed and in the system's PATH."
        }
    except subprocess.TimeoutExpired:
        return {
            "error": "Hand generation timed out. The constraints might be too complex or impossible to satisfy."
        }
    except Exception as e:
        return {"error": f"An error occurred during hand generation: {str(e)}"}

    # 3. Process each generated PBN with 'leadsolver'
    with open(pbn_filename) as f:
        data = f.read()
        print("--------")
        print(data)
        print("--------")

    final_leads = []
    try:
        print(f"{request.leader} {request.contract}")
        command = [
            "leadsolver",
            "-l",
            request.leader,
            request.contract.replace("NT", "N").replace("nt", "n"),
            pbn_filename,
        ]
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        stdout, stderr = process.communicate(timeout=2000)
        os.remove(pbn_filename)

        if process.returncode == 0:
            print(stdout)
            # テキストテーブルの解析
            lines = stdout.strip().split("\n")
            # データ行は 'SA' のようにスートとランクで始まる行
            data_started = False
            for line in lines:
                if re.match(r"^[SHDC][AKQJT0-9]", line.strip()):
                    data_started = True

                if data_started:
                    parts = (
                        line.strip().replace("[", "").replace("]", "").split()
                    )
                    if len(parts) >= 2:
                        try:
                            card = parts[0]
                            tricks = float(parts[1])
                            per_of_set = float(parts[2].replace("*", ""))
                            per_of_trick = [0] * 14
                            per_of_trick[0] = int(parts[3])
                            per_of_trick[1] = int(parts[4])
                            per_of_trick[2] = int(parts[5])
                            per_of_trick[3] = int(parts[6])
                            per_of_trick[4] = int(parts[7])
                            per_of_trick[5] = int(parts[8])
                            per_of_trick[6] = int(parts[9])
                            per_of_trick[7] = int(parts[10])
                            per_of_trick[8] = int(parts[11])
                            per_of_trick[9] = int(parts[12])
                            per_of_trick[10] = int(parts[13])
                            per_of_trick[11] = int(parts[14])
                            per_of_trick[12] = int(parts[15])
                            per_of_trick[13] = int(parts[16])
                            final_leads.append(
                                {
                                    "card": card,
                                    "tricks": tricks,
                                    "per_of_set": per_of_set,
                                    "per_of_trick": per_of_trick,
                                }
                            )
                        except (ValueError, IndexError) as e:
                            # 解析できない行はスキップ
                            print(e)
                            continue
        else:
            return {
                "error": f"Lead solver failed for all generated hands. Please check contract and vulnerability settings. process returned code {process.returncode}. {stdout},{stderr}"
            }
    except Exception as e:
        return {"error": f"An error occurred during hand generation: {str(e)}"}

    final_leads.sort(key=lambda x: x["tricks"])
    print(final_leads)
    return {"leads": final_leads, "simulations_run": len(generated_pbns)}
