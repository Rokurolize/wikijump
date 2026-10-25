import wikidot, json, re, os, sys
OUT = os.environ["PROBE_OUT"]
with wikidot.Client() as c:
    s = c.site.get("scp-wiki")
    res = {}
    for slug in ["scp-9506", "scp-3352"]:
        pg = s.page.get(slug)
        r = s.amc_request([{"moduleName": "watch/WhoWatchesModule", "page_id": pg.id, "verbose": "true"}])[0]
        data = r.json()
        body = data.get("body", "")
        ids = [int(x) for x in re.findall(r'userInfo\((\d+)\)', body)]
        names = re.findall(r'alt=\\?"([^"\\]+)', body)
        print(slug, "page_id", pg.id, "status", data.get("status"), "body_len", len(body), "watchers", len(ids), "unique", len(set(ids)), "more", "And even more" in body, "text_len", len(body))
        res[slug] = {"page_id": pg.id, "watcher_user_ids": ids, "even_more": "And even more" in body, "body_sha256": __import__("hashlib").sha256(body.encode()).hexdigest()}
    json.dump(res, open(os.path.join(OUT, "who-watches.json"), "w"), indent=1)
