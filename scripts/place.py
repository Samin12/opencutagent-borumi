#!/usr/bin/env python3
"""Place, replace or remove an animation in Borumi on ONE MCP connection, end to end.

    python3 place.py --project <name|id|path> --job <outDir>/job.json --action place [--render <file>]
                     [--canvas <canvas.json>] [--summary "..."] [--no-commit] [--frames-dir <dir>] [--out <result.json>]
    python3 place.py --project ... --job ... --action replace --render <file>
    python3 place.py --project ... --job ... --action remove

Order of operations (all on this connection, because Borumi ids must be observed on the connection
that uses them and a transaction lives on the connection that began it): list projects, begin a
transaction, read the range, import the render (its media id is only known now), run
`placement.mjs plan` with that id, execute every step with the latest timeline_hash (re-reading
after structural steps; `find_new_segment` binds $NEW_LAYER/$NEW_SEGMENT; `select` resolves
$SELECT to the split pieces inside the range; `tolerate_missing` deletes ignore a gone id), run
`placement.mjs verify` on the post-step read, grab one frame at the start, middle and end, then
commit (or abort with --no-commit) and re-read the committed project. Any error aborts.

The commit here does NOT go through Claude Code's permission prompt: inside Claude Code the
visualize skill executes the plan itself through the plugin's MCP tools. Use this script from Codex,
cron or batch runs after the user approved the placement in chat. Output: JSON on stdout; the plan,
the timeline reads and the verify result are written next to the job (receipts). After a commit the
placement is recorded in job.json (`job.mjs placed` / `job.mjs unplaced`), so nothing else is needed.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
from borumi_client import BorumiClient, BorumiError  # noqa: E402

STRUCTURAL = {"add_segments", "split_segments", "delete_segments", "trim_timeline", "move_timeline_segments", "untrim_segments", "copy_segments"}
NEEDS_HASH = STRUCTURAL | {"update_segments", "create_scenes", "move_scenes", "delete_scenes"}
GUIDES = ["project_edits", "editing", "importing_media", "editing_layouts", "editing_transitions",
          "editing_segment_take_add", "editing_segment_media_overlay_add", "editing_segment_layout_add",
          "editing_segment_video_update", "editing_segment_layout_update", "editing_segment_media_overlay_update"]


def subst(obj, vars_):
    if isinstance(obj, str):
        return vars_.get(obj, obj) if obj.startswith("$") else obj
    if isinstance(obj, list):
        return [subst(x, vars_) for x in obj]
    if isinstance(obj, dict):
        return {k: subst(v, vars_) for k, v in obj.items()}
    return obj


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def find_new_segment(timeline, media_id, start_ms, segment_type=None, tol=40):
    for layer in timeline.get("layers", []):
        for seg in layer.get("segments", []):
            media = seg.get("media") or {}
            if media.get("media_id") != media_id:
                continue
            if segment_type and seg.get("type") != segment_type:
                continue
            if abs(seg.get("start_ms", -1) - start_ms) <= tol:
                return layer["id"], seg["id"], seg
    return None, None, None


def select_segments(timeline, select):
    kinds = set(select.get("layer_kinds") or [])
    lo, hi = select.get("inside") or [0, 0]
    ids = []
    for layer in timeline.get("layers", []):
        if layer.get("kind") not in kinds and layer.get("id") not in kinds:
            continue
        for seg in layer.get("segments", []):
            if seg.get("start_ms", -1) >= lo and seg.get("end_ms", -1) <= hi:
                ids.append(seg["id"])
    return ids


def run_node(args):
    cmd = [shutil.which("node") or "node"] + args
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        data = json.loads(r.stdout or "{}")
    except Exception:
        data = {"ok": False, "error": (r.stdout or "")[-400:] + (r.stderr or "")[-400:]}
    if r.returncode not in (0, 2):
        raise BorumiError(os.path.basename(args[0]) if args else "node", f"exit {r.returncode}: {(r.stderr or '')[-400:]}")
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--job", required=True)
    ap.add_argument("--action", choices=["place", "replace", "remove"], default="place")
    ap.add_argument("--render")
    ap.add_argument("--canvas")
    ap.add_argument("--summary")
    ap.add_argument("--no-commit", action="store_true")
    ap.add_argument("--frames-dir")
    ap.add_argument("--out")
    ap.add_argument("--placement-script", default=os.path.join(HERE, "placement.mjs"))
    a = ap.parse_args()

    job_path = os.path.abspath(a.job)
    job = json.load(open(job_path))
    out_dir = os.path.dirname(job_path)
    receipts = os.path.join(out_dir, "receipts", f"place-{int(time.time())}")
    os.makedirs(receipts, exist_ok=True)
    start_ms = int(job.get("startMs", job.get("start_ms", 0)))
    end_ms = int(job.get("endMsEffective", job.get("endMs", job.get("end_ms", start_ms))))
    version = job.get("lastRenderedVersion") or job.get("currentVersion") or job.get("version") or 1
    if a.action in ("place", "replace") and not a.render:
        print(json.dumps({"ok": False, "error": "--render is required for place and replace"}))
        return 2
    if a.action in ("remove", "replace") and not job.get("placed"):
        print(json.dumps({"ok": False, "error": "job.json has no placed record to remove"}))
        return 2
    result = {"ok": False, "action": a.action, "steps": [], "warnings": [], "receipts": receipts}
    t0 = time.time()

    with BorumiClient(client_name="borumi-place", log_path=os.path.join(receipts, "mcp.log")) as b:
        b.guides(*GUIDES)
        pr = b.find_project(a.project)
        if not pr:
            print(json.dumps({"ok": False, "error": f"project not open: {a.project}"}))
            return 2
        pid = pr["id"]
        tx = b.call("begin_project_edit", {"project_id": pid})["tx_id"]
        vars_ = {"$TX": tx, "$START_MS": start_ms, "$END_MS": end_ms}
        try:
            def read():
                tl = b.timeline(tx, start_ms - 1000, end_ms + 1000, fields=("media", "properties", "group_id"))
                return tl, tl["timeline_hash"]
            tl, h = read()
            before_duration = tl["duration_ms"]
            json.dump(tl, open(os.path.join(receipts, "timeline-before.json"), "w"))
            media_id = None
            if a.render:
                media = b.import_media(tx, a.render)
                media_id = media["id"]
                vars_["$MEDIA_ID"] = media_id
                result["media"] = media
                log(f"imported {os.path.basename(a.render)} as media {media_id}")
                tl, h = read()
            # plan with the media id this connection knows
            plan_cmd = [a.placement_script, "plan", "--timeline", os.path.join(receipts, "timeline-before.json"), "--job", job_path, "--action", a.action]
            if media_id:
                plan_cmd += ["--media-id", media_id]
            if a.canvas:
                plan_cmd += ["--canvas", os.path.abspath(a.canvas)]
            if job.get("placed") and a.action in ("remove", "replace"):
                prev_path = os.path.join(receipts, "prev-placed.json")
                json.dump(job["placed"], open(prev_path, "w"))
                plan_cmd += ["--prev-placed", prev_path]
            plan_path = os.path.join(receipts, "plan.json")
            plan_cmd += ["--out", plan_path]
            plan = run_node(plan_cmd)
            if not plan.get("steps"):
                raise BorumiError("placement.mjs plan", f"no steps: {plan.get('error') or plan}")
            result["warnings"] += plan.get("warnings", [])
            for w in plan.get("warnings", []):
                log(f"plan warning: {w}")
            for i, step in enumerate(plan["steps"]):
                op = step["op"]
                if op == "find_new_segment":
                    tl, h = read()
                    args = step.get("args", {})
                    layer_id, seg_id, seg = find_new_segment(tl, args.get("media_id") or media_id, int(args.get("start_ms", start_ms)), args.get("segment_type"))
                    if not seg_id:
                        raise BorumiError("find_new_segment", f"no {args.get('segment_type') or 'video'} segment with media {media_id} at {start_ms} ms")
                    vars_["$NEW_LAYER"], vars_["$NEW_SEGMENT"] = layer_id, seg_id
                    result["steps"].append({"op": op, "layer": layer_id, "segment": seg_id, "start_ms": seg["start_ms"], "end_ms": seg["end_ms"]})
                    log(f"new segment {seg_id} on {layer_id} ({seg['start_ms']}-{seg['end_ms']})")
                    continue
                if op == "verify":
                    tl, h = read()
                    after_path = os.path.join(receipts, "timeline-after.json")
                    json.dump(tl, open(after_path, "w"))
                    vcmd = [a.placement_script, "verify", "--timeline", after_path, "--job", job_path, "--plan", plan_path, "--out", os.path.join(receipts, "placed.json")]
                    if media_id:
                        vcmd += ["--media-id", media_id]
                    vres = run_node(vcmd)
                    result["verify"] = vres
                    if not vres.get("ok"):
                        raise BorumiError("verify", "; ".join(vres.get("problems", ["verification failed"])))
                    result["placed"] = vres.get("placed")
                    continue
                args = json.loads(json.dumps(step.get("args", {})))
                if op == "delete_segments" and step.get("select"):
                    # Resolve against the fresh read: explicit ids that still exist plus the pieces the
                    # selector finds inside the range (split pieces get fresh ids; stale ids are dropped).
                    tl, h = read()
                    present = {s["id"] for L in tl.get("layers", []) for s in L.get("segments", [])}
                    explicit = [s for s in subst(args.get("segment_ids") or [], vars_) if s != "$SELECT" and s in present]
                    ids = list(dict.fromkeys(explicit + select_segments(tl, step["select"])))
                    if not ids:
                        result["steps"].append({"op": op, "skipped": "nothing inside the range to delete", "note": step.get("note")})
                        log(f"step {i} {op}: nothing to delete")
                        continue
                    args["segment_ids"] = ids
                args = subst(args, vars_)
                args["tx_id"] = tx
                if op in NEEDS_HASH:
                    args["timeline_hash"] = h
                try:
                    r = b.call(op, args)
                except BorumiError as e:
                    if step.get("tolerate_missing") and ("not_found" in e.message or "unknown" in e.message):
                        result["steps"].append({"op": op, "skipped": e.message[:160], "note": step.get("note")})
                        log(f"step {i} {op}: skipped ({e.message[:100]})")
                        continue
                    raise
                result["steps"].append({"op": op, "note": step.get("note"), "ids": args.get("segment_ids"), "result": r if not isinstance(r, dict) else {k: r[k] for k in list(r)[:6]}})
                log(f"step {i} {op}: ok")
                if op in STRUCTURAL or step.get("reread"):
                    tl, h = read()
            tl, h = read()
            if tl["duration_ms"] != before_duration:
                raise BorumiError("guard", f"project duration changed ({before_duration} -> {tl['duration_ms']} ms); aborting")
            frames = []
            if a.action != "remove":
                for tag, t in (("start", start_ms + 50), ("mid", (start_ms + end_ms) // 2), ("end", end_ms - 80)):
                    f = b.inspect_moment(("tx_id", tx), max(start_ms, min(t, end_ms - 1)))
                    if not f:
                        continue
                    dst_dir = a.frames_dir or os.path.join(out_dir, "frames")
                    os.makedirs(dst_dir, exist_ok=True)
                    dst = os.path.join(dst_dir, f"v{version}-{tag}.jpg")
                    try:
                        shutil.copy(f["path"], dst)
                        frames.append(dst)
                    except Exception:
                        frames.append(f["path"])
            result["frames"] = frames
            if a.no_commit:
                b.call("abort_project_edit", {"tx_id": tx})
                result["ok"] = True
                result["dry_run"] = True
            else:
                scene = job.get("sceneName") or "the scene"
                where = "in front of the footage" if job.get("mode") == "front" else "behind the camera"
                default = {"place": f"Place animation v{version} {where} in {scene}.",
                           "replace": f"Replace the animation with v{version} {where} in {scene}.",
                           "remove": f"Remove the animation from {scene} and restore what it replaced."}[a.action]
                c = b.call("commit_project_edit", {"tx_id": tx, "change_summary": (a.summary or plan.get("summary") or default)[:490]})
                result["commit"] = c
                tl2 = b.timeline_project(pid, start_ms - 1000, end_ms + 1000)
                if media_id:
                    layer_id, seg_id, seg = find_new_segment(tl2, media_id, start_ms)
                    result["confirmed"] = bool(seg_id)
                    if result.get("placed") is not None and seg_id:
                        result["placed"]["layer_id"] = layer_id
                        result["placed"]["commit_id"] = c.get("commit_id")
                        result["placed"]["version"] = version
                elif a.action == "remove":
                    prev = job["placed"]
                    gone = not any(s["id"] in (prev.get("take_segment_id"), prev.get("overlay_segment_id")) for L in tl2.get("layers", []) for s in L.get("segments", []))
                    result["confirmed"] = gone
                    result["placed"] = None
                # Record the outcome in job.json so a later remove/replace (from any host) starts from the truth.
                job_id = job.get("id") or job.get("jobId")
                if job_id:
                    if a.action in ("place", "replace") and result.get("placed"):
                        rec = run_node([os.path.join(HERE, "job.mjs"), "placed", job_id, "--json", json.dumps(result["placed"])])
                        result["recorded"] = {"placed": rec.get("placed") if isinstance(rec, dict) else rec}
                    elif a.action == "remove":
                        rec = run_node([os.path.join(HERE, "job.mjs"), "unplaced", job_id, "--commit-id", str(c.get("commit_id") or "")])
                        result["recorded"] = {"placed": None, "removed": rec.get("removed") if isinstance(rec, dict) else rec}
                    if a.out is None:
                        pass
                    log(f"recorded in job.json: {json.dumps(result.get('recorded'))[:160]}")
                result["ok"] = True
        except BorumiError as e:
            try:
                b.call("abort_project_edit", {"tx_id": tx})
            except Exception:
                pass
            result["error"] = str(e)
            result["ok"] = False
    result["elapsed_s"] = round(time.time() - t0, 1)
    out = json.dumps(result, indent=1)
    if a.out:
        open(a.out, "w").write(out)
    print(out)
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
