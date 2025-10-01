import json
import random
import subprocess
from ctypes import byref
from typing import Dict, List, Optional, Tuple

import dds
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
    simulations: int = Field(default=1000, ge=1, le=10000)


class LeadSolverRequest(BaseModel):
    leader_hand_pbn: str
    shapes: Dict[str, str]
    hcp: Dict[str, List[int]]
    contract: str
    leader: str
    declarer: str
    vulnerability: str
    simulations: int = Field(default=100, ge=10, le=500)


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


@app.post("/api/analyse_single_dummy")
def analyse_single_dummy(request: SingleDummyRequest):
    # (変更なし)
    try:
        pbn_parts = request.pbn[2:].split()
        north_hand_str, south_hand_str = pbn_parts[0], pbn_parts[2]
        all_ranks = "AKQJT98765432"
        remaining_cards = []
        for i in range(4):
            ns_suit_cards = set(north_hand_str.split(".")[i]) | set(
                south_hand_str.split(".")[i]
            )
            for rank in all_ranks:
                if rank not in ns_suit_cards:
                    remaining_cards.append((i, rank))
        if len(remaining_cards) != 26:
            return {"error": "Invalid number of cards for North and South."}
        dist = {s: {"North": [0] * 14, "South": [0] * 14} for s in range(5)}
        valid_sims = 0
        for _ in range(request.simulations):
            random.shuffle(remaining_cards)
            east_cards, west_cards = sorted(remaining_cards[:13]), sorted(
                remaining_cards[13:]
            )
            east_hand = [
                "".join(r for s, r in east_cards if s == i) for i in range(4)
            ]
            west_hand = [
                "".join(r for s, r in west_cards if s == i) for i in range(4)
            ]
            east_str = ".".join(
                "".join(sorted(s, key=lambda x: all_ranks.find(x))) or "-"
                for s in east_hand
            )
            west_str = ".".join(
                "".join(sorted(s, key=lambda x: all_ranks.find(x))) or "-"
                for s in west_hand
            )
            full_pbn = (
                f"N:{north_hand_str} {east_str} {south_hand_str} {west_str}"
            )
            # ... (DDS計算部分は変更なし) ...
        # ... (結果整形部分は変更なし) ...
    except Exception as e:
        return {"error": f"An error occurred: {str(e)}"}
    return {
        "trick_distribution": response_dist,
        "simulations_run": valid_simulations,
    }


@app.post("/api/solve_lead")
def solve_opening_lead(request: LeadSolverRequest):
    aggregated_results, valid_simulations = {}, 0

    # 1. Construct the condition string for the 'dealer' command
    conditions = []

    # Leader's hand condition
    # Convert PBN to dealer format: SAKQ.HJ.D54.CQT98
    leader_hand_dealer = "".join(
        [
            f"S{request.leader_hand_pbn.split('.')[0]}."
            f"H{request.leader_hand_pbn.split('.')[1]}."
            f"D{request.leader_hand_pbn.split('.')[2]}."
            f"C{request.leader_hand_pbn.split('.')[3]}"
        ]
    ).replace("-", "")
    conditions.append(f"hand({request.leader},{leader_hand_dealer})")

    # Other players' conditions
    other_players = [
        p for p in ["north", "south", "east", "west"] if p != request.leader
    ]
    for p in other_players:
        # Shape condition
        # Input: "5-5,3-3,3-3,2-2" -> Output: "shape(p, 5,3,3,2)" (if ranges are single values)
        # or "shape(p, 4-5, 3-4, 2-3, 1-2)"
        shape_parts = request.shapes[p].split(",")
        shape_str = ",".join(shape_parts)
        conditions.append(f"shape({p},{shape_str})")

        # HCP condition
        hcp_range = request.hcp[p]
        conditions.append(f"hcp({p}, {hcp_range[0]}, {hcp_range[1]})")

    condition_string = " and ".join(conditions)

    # 2. Call the 'dealer' command to generate hands
    try:
        command = [
            "deal",
            "-n",
            str(request.simulations),
            "-p",  # Print PBN format
            "-c",
            condition_string,
        ]
        process = subprocess.Popen(
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        stdout, stderr = process.communicate(timeout=60)  # 60-second timeout

        if process.returncode != 0:
            return {"error": f"Dealer command failed: {stderr}"}

        generated_pbns = stdout.strip().split("\n")

    except FileNotFoundError:
        return {
            "error": "The 'dealer' command is not found. Please ensure it is installed and in the system's PATH."
        }
    except subprocess.TimeoutExpired:
        return {
            "error": "Hand generation timed out. The constraints might be too complex or impossible to satisfy."
        }
    except Exception as e:
        return {"error": f"An error occurred during hand generation: {str(e)}"}

    # 3. Process each generated PBN with 'leadsolver'
    for pbn in generated_pbns:
        if not pbn.startswith("N:"):
            continue

        try:
            command = [
                "leadsolver",
                "--pbn",
                pbn,
                "--contract",
                request.contract,
                "--leader",
                request.leader,
                "--declarer",
                request.declarer,
                "--vul",
                request.vulnerability,
            ]
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            stdout, stderr = process.communicate(timeout=30)

            if process.returncode == 0:
                result = json.loads(stdout)
                for lead in result.get("leads", []):
                    card, tricks = lead.get("card"), lead.get("tricks")
                    if card and tricks is not None:
                        if card not in aggregated_results:
                            aggregated_results[card] = []
                        aggregated_results[card].append(tricks)
                valid_simulations += 1
        except Exception:
            # Continue to the next PBN even if one fails
            continue

    if valid_simulations == 0:
        return {
            "error": "Lead solver failed for all generated hands. Please check contract and vulnerability settings."
        }

    final_leads = [
        {"card": c, "tricks": sum(t) / len(t)}
        for c, t in aggregated_results.items()
    ]
    final_leads.sort(key=lambda x: x["tricks"])
    return {"leads": final_leads[:15], "simulations_run": valid_simulations}
