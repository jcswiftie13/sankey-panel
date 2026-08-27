#!/usr/bin/env python3
"""Switch interface increment trace -> Sankey.

Reads a trace JSON (same contract as the web app), merges hops that belong to
the same switch, solves the per-hop residual so the picture conserves flow, and
then prints a text report, emits Mermaid, or renders an interactive Plotly page.

Bandwidths are always the actual increment; the gap is carried by per-hop
other-in / other-out, so every hop balances:

    known in + other in  ==  traced out + other out

How much of that is attributable to the investigated counter is reported as a
number next to the graph, never as a second set of bandwidths.

Usage:
    python3 tools/trace_sankey.py samples/classic.json
    python3 tools/trace_sankey.py trace.json --mermaid sankey
    python3 tools/trace_sankey.py trace.json --plotly out.html
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from typing import Any

# --------------------------------------------------------------------------- #
# formatting
# --------------------------------------------------------------------------- #
def fmt_bps(bps: float) -> str:
    n = float(bps or 0)
    a = abs(n)
    for unit, div in (("Tbps", 1e12), ("Gbps", 1e9), ("Mbps", 1e6), ("kbps", 1e3)):
        if a >= div:
            return f"{n / div:g} {unit}"
    return f"{n:g} bps"


def gbps(bps: float) -> float:
    return round(float(bps or 0) / 1e9, 3)


# --------------------------------------------------------------------------- #
# model
# --------------------------------------------------------------------------- #
@dataclass
class Edge:
    from_id: str
    to_id: str
    from_iface: str
    to_iface: str
    bps: float
    peer_kind: str | None = None
    namespace: str | None = None
    is_anchor: bool = False
    attr: float = 0.0
    lateral: bool = False
    dropped: bool = False       # excluded from column layout by cycle-breaking
    backward: bool = False      # final columns run right-to-left: drawn as backflow


@dataclass
class Node:
    id: str
    label: str
    kind: str = "node"          # node | leaf | anchor
    role: str = "switch"        # switch | node | pod | leaf | anchor
    tier: str | None = None
    sub_order: int = 0
    hop_count: int = 0
    namespace: str | None = None
    iface: str | None = None
    other_in_bps: float | None = None
    other_out_bps: float | None = None
    in_edges: list[Edge] = field(default_factory=list)
    out_edges: list[Edge] = field(default_factory=list)
    col: int = 0
    is_root: bool = False
    traced_in: float = 0.0
    traced_out: float = 0.0
    other_in: float = 0.0
    other_out: float = 0.0
    attr_in: float = 0.0
    attr_out: float = 0.0


class TraceError(ValueError):
    pass


def validate(doc: Any) -> list[str]:
    errs: list[str] = []
    if not isinstance(doc, dict):
        return ["top level must be a JSON object"]
    inv = doc.get("investigation")
    if not isinstance(inv, dict):
        errs.append("investigation is required")
    else:
        if not inv.get("switchId"):
            errs.append("investigation.switchId is required")
        if not inv.get("iface"):
            errs.append("investigation.iface is required")
        d = inv.get("deltaBps")
        if not isinstance(d, (int, float)) or d <= 0:
            errs.append("investigation.deltaBps must be a positive number of bps")
        if inv.get("direction") not in (None, "in", "out"):
            errs.append('investigation.direction must be "in" or "out"')
    if doc.get("kind") not in (None, "destination", "source"):
        errs.append('kind must be "destination" or "source"')
    hops = doc.get("hops")
    if not isinstance(hops, list) or not hops:
        errs.append("hops must be a non-empty array")
    else:
        for i, h in enumerate(hops):
            if not isinstance(h, dict):
                errs.append(f"hops[{i}] is not an object")
                continue
            if not h.get("switchId"):
                errs.append(f"hops[{i}].switchId is required")
            tier = h.get("tier")
            if tier is not None and (not isinstance(tier, str) or not tier):
                errs.append(f"hops[{i}].tier must be a non-empty string")
            for key in ("outputs", "inputs"):
                ports = h.get(key)
                if ports is None:
                    continue
                if not isinstance(ports, list):
                    errs.append(f"hops[{i}].{key} must be an array")
                    continue
                for j, p in enumerate(ports):
                    if not isinstance(p, dict):
                        errs.append(f"hops[{i}].{key}[{j}] is not an object")
                        continue
                    if not p.get("iface"):
                        errs.append(f"hops[{i}].{key}[{j}].iface is required")
                    v = p.get("deltaBps")
                    if not isinstance(v, (int, float)) or v < 0:
                        errs.append(f"hops[{i}].{key}[{j}].deltaBps must be >= 0")
    return errs


def direction_of(doc: dict) -> str:
    if doc.get("kind") in ("source", "destination"):
        return doc["kind"]
    if (doc.get("investigation") or {}).get("direction") == "out":
        return "source"
    return "destination"


class Trace:
    """Graph built from a trace document. Packets always flow left to right."""

    def __init__(self, doc: dict):
        errs = validate(doc)
        if errs:
            raise TraceError("; ".join(errs))
        self.doc = doc
        self.dir = direction_of(doc)
        self.inv = doc["investigation"]
        self.pruning = doc.get("pruning") or {}
        self.warnings: list[str] = []
        self.nodes: dict[str, Node] = {}
        self.order: list[str] = []
        self.edges: list[Edge] = []
        self._merge_hops()
        self._link()
        self._anchor()
        self._columns()
        self._residuals()
        self._attribute()

    # -- 1. same switchId appearing twice (dual uplink) becomes one box ------ #
    def _merge_hops(self) -> None:
        self.ports: dict[str, dict[str, dict]] = {}
        for h in self.doc["hops"]:
            sid = h["switchId"]
            n = self.nodes.get(sid)
            if n is None:
                n = self.nodes[sid] = Node(id=sid, label=h.get("label") or sid,
                                           role=h.get("role") or "switch")
                self.order.append(sid)
                self.ports[sid] = {}
            n.hop_count += 1
            if h.get("label"):
                n.label = h["label"]
            if h.get("role"):
                n.role = h["role"]
            if h.get("tier"):
                if n.tier is None:
                    n.tier = h["tier"]
                elif n.tier != h["tier"]:
                    self.warnings.append(
                        f"{n.label}: different tier across hops "
                        f"({n.tier!r} vs {h['tier']!r}); keeping the first {n.tier!r}")
            for key, attr in (("otherInBps", "other_in_bps"), ("otherOutBps", "other_out_bps")):
                if isinstance(h.get(key), (int, float)):
                    cur = getattr(n, attr) or 0.0
                    setattr(n, attr, cur + float(h[key]))
            side = "outputs" if self.dir == "destination" else "inputs"
            for p in h.get(side) or []:
                pk = f"{p['iface']}|{p.get('peerSwitchId') or p.get('peerId') or ''}"
                slot = self.ports[sid].setdefault(pk, {
                    "iface": p["iface"], "deltaBps": 0.0,
                    "peerKind": p.get("peerKind"), "peerId": p.get("peerId"),
                    "peerSwitchId": p.get("peerSwitchId"), "peerIface": p.get("peerIface"),
                    "namespace": p.get("namespace"),
                })
                slot["deltaBps"] += float(p["deltaBps"])
        if self.inv["switchId"] not in self.nodes:
            raise TraceError(f"investigation.switchId {self.inv['switchId']!r} not found in hops")

    # -- 2. edges, always in packet direction ------------------------------- #
    def _link(self) -> None:
        leaf_seq = 0
        for sid in list(self.order):
            node = self.nodes[sid]
            for p in self.ports.get(sid, {}).values():
                peer_key = p.get("peerSwitchId") or p.get("peerId")
                peer = self.nodes.get(peer_key) if peer_key else None
                if peer is None:
                    leaf_seq += 1
                    peer = Node(
                        id=f"leaf-{leaf_seq}", kind="leaf",
                        role="pod" if p.get("peerKind") == "pod" else "leaf",
                        label=p.get("peerId") or p.get("peerSwitchId") or p["iface"],
                        namespace=p.get("namespace"),
                        iface=p.get("peerIface") or p["iface"],
                    )
                    self.nodes[peer.id] = peer
                    self.order.append(peer.id)
                if self.dir == "destination":
                    e = Edge(node.id, peer.id, p["iface"],
                             p.get("peerIface") or "",
                             p["deltaBps"], p.get("peerKind"), p.get("namespace"))
                else:
                    e = Edge(peer.id, node.id,
                             p.get("peerIface") or "",
                             p["iface"], p["deltaBps"], p.get("peerKind"), p.get("namespace"))
                self.edges.append(e)

    # -- 3. the investigated counter itself ---------------------------------- #
    def _anchor(self) -> None:
        self.root = self.nodes[self.inv["switchId"]]
        self.root.is_root = True
        a = Node(id="__anchor__", label="TRACE START", kind="anchor", role="anchor",
                 iface=self.inv["iface"])
        self.nodes[a.id] = a
        self.order.append(a.id)
        if self.dir == "destination":
            e = Edge(a.id, self.root.id, self.inv["iface"], self.inv["iface"], float(self.inv["deltaBps"]))
        else:
            e = Edge(self.root.id, a.id, self.inv["iface"], self.inv["iface"], float(self.inv["deltaBps"]))
        e.is_anchor = True
        self.anchor_edge = e
        self.edges.append(e)
        for edge in self.edges:
            self.nodes[edge.from_id].out_edges.append(edge)
            self.nodes[edge.to_id].in_edges.append(edge)

    # -- 4. longest-path columns -------------------------------------------- #
    # Nodes sharing a tier act as one super-node: intra-tier edges do not
    # constrain columns, so a same-layer mesh (bdr <-> dci) stays in one column.
    # Untagged nodes are singleton groups, i.e. plain longest-path.
    def _columns(self) -> None:
        group_of = {i: (f"t:{n.tier}" if n.tier is not None else f"n:{i}")
                    for i, n in self.nodes.items()}
        groups = list(dict.fromkeys(group_of.values()))

        def glabel(g: str) -> str:
            return f"tier {g[2:]!r}" if g.startswith("t:") else self.nodes[g[2:]].label

        # 4a. total flow per direction between groups
        gflow: dict[tuple[str, str], float] = {}
        for e in self.edges:
            ga, gb = group_of[e.from_id], group_of[e.to_id]
            if ga == gb:
                continue
            gflow[(ga, gb)] = gflow.get((ga, gb), 0.0) + e.bps

        # 4b. both directions present between two groups = a cycle. Majority
        # vote by flow: the smaller direction is drawn as backflow and excluded
        # from column layout, so tiers are never abandoned. Ties keep the
        # first-seen group upstream (deterministic).
        dropped: set[tuple[str, str]] = set()
        for k in list(gflow):
            rk = (k[1], k[0])
            if rk not in gflow or k in dropped or rk in dropped:
                continue
            loser = k
            if gflow[k] > gflow[rk] or (
                    gflow[k] == gflow[rk] and groups.index(k[0]) < groups.index(k[1])):
                loser = rk
            dropped.add(loser)
            winner = (loser[1], loser[0])
            self.warnings.append(
                f"{glabel(loser[0])} -> {glabel(loser[1])} goes against the majority "
                f"flow ({fmt_bps(gflow[loser])} vs {fmt_bps(gflow[winner])}); "
                "drawn as backflow, excluded from column layout")

        # 4c. majority vote is pairwise; a cycle through 3+ groups may remain.
        # Only edges inside a strongly connected component of size > 1 are
        # really on a cycle (Kahn leftovers would also net everything
        # downstream of the cycle); greedily drop the smallest-flow one.
        def scc_of(live: list[tuple[str, str]]) -> tuple[dict[str, int], list[int]]:
            adj: dict[str, list[str]] = {g: [] for g in groups}
            radj: dict[str, list[str]] = {g: [] for g in groups}
            for ga, gb in live:
                adj[ga].append(gb)
                radj[gb].append(ga)
            seen: set[str] = set()
            post: list[str] = []

            def dfs(g: str) -> None:
                seen.add(g)
                for h in adj[g]:
                    if h not in seen:
                        dfs(h)
                post.append(g)

            for g in groups:
                if g not in seen:
                    dfs(g)
            comp: dict[str, int] = {}
            size: list[int] = []
            for s in reversed(post):
                if s in comp:
                    continue
                cur = len(size)
                size.append(0)
                stack = [s]
                while stack:
                    v = stack.pop()
                    if v in comp:
                        continue
                    comp[v] = cur
                    size[cur] += 1
                    stack.extend(w for w in radj[v] if w not in comp)
            return comp, size

        while True:
            live = [k for k in gflow if k not in dropped]
            comp, size = scc_of(live)
            cyclic = [k for k in live
                      if comp[k[0]] == comp[k[1]] and size[comp[k[0]]] > 1]
            if not cyclic:
                break
            victim = min(cyclic, key=lambda k: gflow[k])
            dropped.add(victim)
            self.warnings.append(
                "group graph still cyclic; dropping its smallest-flow edge "
                f"{glabel(victim[0])} -> {glabel(victim[1])} ({fmt_bps(gflow[victim])}); "
                "drawn as backflow")

        # 4d. longest path on the now-acyclic group graph
        for e in self.edges:
            ga, gb = group_of[e.from_id], group_of[e.to_id]
            e.dropped = ga != gb and (ga, gb) in dropped
        gcol = {g: 0 for g in groups}
        for _ in range(len(groups) + 2):
            moved = False
            for e in self.edges:
                if e.dropped:
                    continue
                ga, gb = group_of[e.from_id], group_of[e.to_id]
                if ga == gb:
                    continue
                if gcol[gb] < gcol[ga] + 1:
                    gcol[gb] = gcol[ga] + 1
                    moved = True
            if not moved:
                break
        else:
            self.warnings.append("topology looks cyclic; column order may be off")
        for i, n in self.nodes.items():
            n.col = gcol[group_of[i]]
        low = min(n.col for n in self.nodes.values())
        for n in self.nodes.values():
            n.col -= low
        for e in self.edges:
            e.lateral = self.nodes[e.from_id].col == self.nodes[e.to_id].col
            e.backward = self.nodes[e.from_id].col > self.nodes[e.to_id].col
        self._tier_sub_order()

    # Topological order inside each tier group, so the attribution sweep visits
    # producers before consumers when columns tie.
    def _tier_sub_order(self) -> None:
        groups: dict[str, list[str]] = {}
        for i, n in self.nodes.items():
            if n.tier is not None:
                groups.setdefault(n.tier, []).append(i)
        for tier, members in groups.items():
            if len(members) < 2:
                continue
            in_group = set(members)
            indeg = {i: 0 for i in members}
            adj: dict[str, list[str]] = {i: [] for i in members}
            for e in self.edges:
                if e.from_id in in_group and e.to_id in in_group:
                    adj[e.from_id].append(e.to_id)
                    indeg[e.to_id] += 1
            queue = [i for i in members if indeg[i] == 0]
            seq = 0
            popped: set[str] = set()
            while queue:
                cur = queue.pop(0)
                popped.add(cur)
                self.nodes[cur].sub_order = seq
                seq += 1
                for m in adj[cur]:
                    indeg[m] -= 1
                    if indeg[m] == 0:
                        queue.append(m)
            if seq < len(members):
                self.warnings.append(
                    f"tier {tier!r} has an internal cycle; "
                    "flow on the cycle cannot be fully attributed")
                for i in members:
                    if i not in popped:
                        self.nodes[i].sub_order = seq
                        seq += 1

    # -- 5. residuals -------------------------------------------------------- #
    def _residuals(self) -> None:
        for n in self.nodes.values():
            if n.kind != "node":
                continue
            n.traced_in = sum(e.bps for e in n.in_edges)
            n.traced_out = sum(e.bps for e in n.out_edges)
            oi, oo = n.other_in_bps, n.other_out_bps
            if oi is not None and oo is not None:
                gap = (n.traced_in + oi) - (n.traced_out + oo)
                if abs(gap) > max(n.traced_in, n.traced_out) * 0.005 + 1:
                    self.warnings.append(
                        f"{n.label}: explicit otherInBps/otherOutBps do not balance "
                        f"(off by {fmt_bps(gap)}); drawing the explicit values")
            elif oo is not None:
                oi = max(0.0, n.traced_out + oo - n.traced_in)
            elif oi is not None:
                oo = max(0.0, n.traced_in + oi - n.traced_out)
            else:
                d = n.traced_out - n.traced_in
                oi, oo = max(0.0, d), max(0.0, -d)
            n.other_in, n.other_out = oi or 0.0, oo or 0.0

    # -- 6. attribution back to the investigated counter --------------------- #
    def _attribute(self) -> None:
        # Sweep in topological order of the DAG left after cycle-breaking:
        # backflow (dropped) edges are excluded, so the flow they carry is not
        # re-distributed downstream (that would amplify around the cycle).
        indeg = {i: 0 for i in self.nodes}
        adj: dict[str, list[str]] = {i: [] for i in self.nodes}
        for e in self.edges:
            if e.dropped:
                continue
            adj[e.from_id].append(e.to_id)
            indeg[e.to_id] += 1

        def key(i: str) -> tuple[int, int]:
            return (self.nodes[i].col, self.nodes[i].sub_order)

        ready = sorted((i for i in self.nodes if indeg[i] == 0), key=key)
        topo: list[str] = []
        while ready:
            cur = ready.pop(0)
            topo.append(cur)
            for m in adj[cur]:
                indeg[m] -= 1
                if indeg[m] == 0:
                    ready.append(m)
            ready.sort(key=key)   # ties keep the old (col, sub_order) order
        if len(topo) < len(self.nodes):   # intra-tier cycle; warned already
            seen = set(topo)
            topo += sorted((i for i in self.nodes if i not in seen), key=key)
        topo_idx = {i: k for k, i in enumerate(topo)}

        self.anchor_edge.attr = float(self.inv["deltaBps"])
        seq = topo if self.dir == "destination" else list(reversed(topo))
        for i in seq:
            n = self.nodes[i]
            if n.kind != "node":
                continue
            if self.dir == "destination":
                got = sum(e.attr for e in n.in_edges)
                denom = n.traced_out + n.other_out
                n.attr_in = got
                n.attr_out = got * (n.traced_out / denom) if denom > 0 else 0.0
                for e in n.out_edges:
                    e.attr = got * (e.bps / denom) if denom > 0 else 0.0
            else:
                got = sum(e.attr for e in n.out_edges)
                denom = n.traced_in + n.other_in
                n.attr_out = got
                n.attr_in = got * (n.traced_in / denom) if denom > 0 else 0.0
                for e in n.in_edges:
                    e.attr = got * (e.bps / denom) if denom > 0 else 0.0
        lost = sum(e.attr for e in self.edges
                   if (e.dropped or e.backward) and topo_idx[e.from_id] > topo_idx[e.to_id])
        if lost > 1:
            self.warnings.append(
                f"backflow carries {fmt_bps(lost)} of attributable traffic back "
                "upstream; not re-distributed to avoid amplifying around the cycle")

    # -- helpers ------------------------------------------------------------- #
    def hop_nodes(self) -> list[Node]:
        return sorted((n for n in self.nodes.values() if n.kind == "node"), key=lambda n: n.col)


# --------------------------------------------------------------------------- #
# text report
# --------------------------------------------------------------------------- #
def report(t: Trace) -> str:
    inv = t.inv
    side = "in" if t.dir == "destination" else "out"
    pin = "leftmost" if t.dir == "destination" else "rightmost"
    L = [
        "=" * 74,
        f"trace {t.dir}  |  packets flow left -> right  |  start pinned {pin}",
        f"start: {inv['switchId']} {inv['iface']} {side} +{fmt_bps(inv['deltaBps'])}",
    ]
    if inv.get("note"):
        L.append(f"note : {inv['note']}")
    pr = t.pruning
    if pr:
        L.append(f"prune: topN={pr.get('topN', '-')} minShare={pr.get('minShare', '-')}")
    L.append("=" * 74)

    for n in t.hop_nodes():
        merged = f"  (merged {n.hop_count} hops)" if n.hop_count > 1 else ""
        role = f" [{n.role}]" if n.role != "switch" else ""
        anchored = "in" if t.dir == "destination" else "out"
        L.append("")
        L.append(f"hop {n.col}  {n.label} <{n.id}>{role}{merged}")

        tag_in = "  <- investigated counter" if (t.dir == "destination" and n.is_root) else ""
        L.append(f"    in   traced {fmt_bps(n.traced_in):>12}{tag_in}")
        for e in n.in_edges:
            peer = t.nodes[e.from_id]
            note = "  [investigated counter]" if peer.kind == "anchor" else ""
            L.append(f"      <- {e.to_iface:<14} {fmt_bps(e.bps):>12}  from {peer.label}{note}")
        if n.other_in > 0:
            L.append(f"      +  other in     {fmt_bps(n.other_in):>12}  (other uplinks / untraced sources)")

        tag_out = "  <- investigated counter" if (t.dir == "source" and n.is_root) else ""
        L.append(f"    out  traced {fmt_bps(n.traced_out):>12}{tag_out}")
        for e in n.out_edges:
            peer = t.nodes[e.to_id]
            note = ""
            if peer.kind == "leaf":
                note = "  [STOP: not followed further]"
            elif peer.kind == "anchor":
                note = "  [investigated counter]"
            if e.backward:
                note += "  [backflow]"
            ns = f" ns/{peer.namespace}" if peer.namespace else ""
            L.append(f"      -> {e.from_iface:<14} {fmt_bps(e.bps):>12}  to {peer.label}{ns}{note}")
        if n.other_out > 0:
            L.append(f"      +  other out    {fmt_bps(n.other_out):>12}  (pruned / too small / over topN)")

        bal_l = n.traced_in + n.other_in
        bal_r = n.traced_out + n.other_out
        L.append(f"    balance      {fmt_bps(bal_l)} in  ==  {fmt_bps(bal_r)} out")
        L.append(f"    attributable {fmt_bps(n.attr_out if t.dir == 'destination' else n.attr_in)}"
                 f"  (of the traced {anchored} increment)")

    L.append("")
    L.append("-" * 74)
    L.append(f"{'hop':<26}{'traced in':>12}{'traced out':>13}{'other in':>11}{'other out':>11}{'attributable':>14}")
    for n in t.hop_nodes():
        attr = n.attr_out if t.dir == "destination" else n.attr_in
        L.append(f"{n.label[:24]:<26}{fmt_bps(n.traced_in):>12}{fmt_bps(n.traced_out):>13}"
                 f"{('+' + fmt_bps(n.other_in)) if n.other_in else '-':>11}"
                 f"{fmt_bps(n.other_out) if n.other_out else '-':>11}"
                 f"{fmt_bps(attr):>14}")
    for w in t.warnings:
        L.append(f"! {w}")
    return "\n".join(L)


# --------------------------------------------------------------------------- #
# mermaid
# --------------------------------------------------------------------------- #
def _q(s: str) -> str:
    s = str(s or "")
    return '"' + s.replace('"', '""') + '"' if ('"' in s or "," in s) else s


def _name(t: Trace, n: Node) -> str:
    if n.kind == "anchor":
        return f"TRACE START {t.inv['iface']}"
    if n.kind == "leaf" and n.namespace:
        return f"{n.label} ({n.namespace})"
    return n.label


def mermaid_sankey(t: Trace) -> str:
    L = ["---", "config:", "  sankey:", "    showValues: true", "---", "sankey-beta", "",
         "%% values in Gbps; residual carried by per-hop other-in / other-out nodes"]
    for e in t.edges:
        v = gbps(e.bps)
        if v <= 0:
            continue
        if e.backward:   # sankey-beta cannot draw cycles
            L.append(f"%% backflow skipped: {_name(t, t.nodes[e.from_id])}"
                     f" -> {_name(t, t.nodes[e.to_id])}, {v}")
            continue
        L.append(f"{_q(_name(t, t.nodes[e.from_id]))},{_q(_name(t, t.nodes[e.to_id]))},{v}")
    for n in t.hop_nodes():
        if n.other_in > 0:
            L.append(f"{_q('other in - ' + n.label)},{_q(n.label)},{gbps(n.other_in)}")
        if n.other_out > 0:
            L.append(f"{_q(n.label)},{_q('other out - ' + n.label)},{gbps(n.other_out)}")
    return "\n".join(L)


def mermaid_flow(t: Trace) -> str:
    def nid(s: str) -> str:
        return "n_" + "".join(c if c.isalnum() else "_" for c in str(s))

    L = ["flowchart LR"]
    for n in sorted(t.nodes.values(), key=lambda n: n.col):
        if n.kind == "node":
            label = f"{n.label}<br/>{n.id}" + (f"<br/>merged {n.hop_count} hops" if n.hop_count > 1 else "")
            cls = ":::k8snode" if n.role == "node" else (":::root" if n.is_root else "")
            L.append(f'  {nid(n.id)}["{label}"]{cls}')
        elif n.kind == "leaf":
            v = n.in_edges[0] if t.dir == "destination" else n.out_edges[0]
            val = fmt_bps(v.bps) if v else "0"
            ns = f"<br/>ns/{n.namespace}" if n.namespace else ""
            L.append(f'  {nid(n.id)}("STOP<br/>{n.label}{ns}<br/>{val}<br/>not followed"):::leaf')
        else:
            L.append(f'  {nid(n.id)}(["TRACE START<br/>{t.inv["iface"]}<br/>{fmt_bps(t.inv["deltaBps"])}"]):::anchor')
    for e in t.edges:
        a, b = t.nodes[e.from_id], t.nodes[e.to_id]
        lbl = f'{e.from_iface or "?"} -> {e.to_iface or "?"}<br/>{fmt_bps(e.bps)}'
        if e.backward:
            lbl += "<br/>(backflow)"
        arrow = f'-. "{lbl}" .->' if b.kind == "leaf" else f'-- "{lbl}" -->'
        L.append(f"  {nid(a.id)} {arrow} {nid(b.id)}")
    for n in t.hop_nodes():
        if n.other_in > 0:
            L.append(f'  oi_{nid(n.id)}(["other in<br/>+{fmt_bps(n.other_in)}"]):::otherin')
            L.append(f"  oi_{nid(n.id)} -.-> {nid(n.id)}")
        if n.other_out > 0:
            L.append(f'  oo_{nid(n.id)}(["other out<br/>{fmt_bps(n.other_out)}<br/>pruned"]):::otherout')
            L.append(f"  {nid(n.id)} -.-> oo_{nid(n.id)}")
    L += [
        "  classDef root stroke:#22d3ee,stroke-width:2px;",
        "  classDef k8snode stroke:#7dd3fc,stroke-dasharray:6 4;",
        "  classDef leaf stroke:#94a3b8,stroke-dasharray:5 4,color:#94a3b8;",
        "  classDef anchor stroke:#22d3ee,stroke-dasharray:4 3;",
        "  classDef otherin stroke:#f59e0b,stroke-dasharray:4 3,color:#f59e0b;",
        "  classDef otherout stroke:#fb7185,stroke-dasharray:4 3,color:#fb7185;",
    ]
    return "\n".join(L)


# --------------------------------------------------------------------------- #
# plotly (optional, local only)
# --------------------------------------------------------------------------- #
def plotly_html(t: Trace, out_path: str) -> str:
    try:
        import plotly.graph_objects as go
    except ImportError as exc:  # pragma: no cover - depends on local env
        raise TraceError("plotly is not installed here; try: pip install plotly") from exc

    labels: list[str] = []
    colors: list[str] = []
    index: dict[str, int] = {}

    def idx(key: str, label: str, color: str) -> int:
        if key not in index:
            index[key] = len(labels)
            labels.append(label)
            colors.append(color)
        return index[key]

    src: list[int] = []
    dst: list[int] = []
    val: list[float] = []
    lcolor: list[str] = []
    ltext: list[str] = []

    for n in t.nodes.values():
        if n.kind == "node":
            idx(n.id, n.label, "#7dd3fc" if n.role == "node" else "#22d3ee")
        elif n.kind == "leaf":
            idx(n.id, f"{n.label} (stop)", "#94a3b8")
        else:
            idx(n.id, f"start {t.inv['iface']}", "#22d3ee")

    for e in t.edges:
        v = gbps(e.bps)
        if v <= 0:
            continue
        src.append(index[e.from_id])
        dst.append(index[e.to_id])
        val.append(v)
        lcolor.append("rgba(34,211,238,0.45)")
        ltext.append(f"{e.from_iface} -> {e.to_iface}: {fmt_bps(e.bps)}")

    for n in t.hop_nodes():
        if n.other_in > 0:
            i = idx("oi:" + n.id, f"other in ({n.label})", "#f59e0b")
            src.append(i); dst.append(index[n.id]); val.append(gbps(n.other_in))
            lcolor.append("rgba(245,158,11,0.35)")
            ltext.append(f"other inputs into {n.label}: {fmt_bps(n.other_in)}")
        if n.other_out > 0:
            i = idx("oo:" + n.id, f"other out ({n.label})", "#fb7185")
            src.append(index[n.id]); dst.append(i); val.append(gbps(n.other_out))
            lcolor.append("rgba(251,113,133,0.35)")
            ltext.append(f"pruned / untracked outputs of {n.label}: {fmt_bps(n.other_out)}")

    fig = go.Figure(go.Sankey(
        arrangement="snap",
        node=dict(label=labels, color=colors, pad=22, thickness=16,
                  line=dict(color="#22303f", width=1)),
        link=dict(source=src, target=dst, value=val, color=lcolor,
                  customdata=ltext, hovertemplate="%{customdata}<extra></extra>"),
    ))
    inv = t.inv
    fig.update_layout(
        title=(f"{inv['switchId']} {inv['iface']} "
               f"{'in' if t.dir == 'destination' else 'out'} +{fmt_bps(inv['deltaBps'])} "
               f"— {t.dir} trace"),
        paper_bgcolor="#0b1017", plot_bgcolor="#0b1017",
        font=dict(color="#e6edf5", size=13), height=max(420, 120 + 70 * len(t.hop_nodes())),
    )
    fig.write_html(out_path, include_plotlyjs="cdn")
    return out_path


# --------------------------------------------------------------------------- #
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("trace", help="path to trace JSON, or - for stdin")
    ap.add_argument("--mermaid", choices=("sankey", "flow"), help="print Mermaid instead of the report")
    ap.add_argument("--plotly", metavar="OUT.html", help="render an interactive Sankey (needs plotly)")
    ap.add_argument("--json", action="store_true", help="print the solved model as JSON")
    args = ap.parse_args(argv)

    raw = sys.stdin.read() if args.trace == "-" else open(args.trace, encoding="utf-8").read()
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"bad JSON: {exc}", file=sys.stderr)
        return 2
    try:
        t = Trace(doc)
    except TraceError as exc:
        print(f"bad trace: {exc}", file=sys.stderr)
        return 2

    if args.plotly:
        try:
            print(f"wrote {plotly_html(t, args.plotly)}")
        except TraceError as exc:
            print(str(exc), file=sys.stderr)
            return 3
    if args.mermaid == "sankey":
        print(mermaid_sankey(t))
    elif args.mermaid == "flow":
        print(mermaid_flow(t))
    elif args.json:
        print(json.dumps({
            "dir": t.dir,
            "hops": [{
                "switchId": n.id, "label": n.label, "col": n.col, "role": n.role,
                "mergedHops": n.hop_count,
                "tracedInBps": n.traced_in, "tracedOutBps": n.traced_out,
                "otherInBps": n.other_in, "otherOutBps": n.other_out,
                "attributableBps": n.attr_out if t.dir == "destination" else n.attr_in,
            } for n in t.hop_nodes()],
            "warnings": t.warnings,
        }, ensure_ascii=False, indent=2))
    elif not args.plotly:
        print(report(t))
    for w in t.warnings:
        print(f"! {w}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
