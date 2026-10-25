import os, json, hashlib, wikidot
OUT = os.environ["PROBE_OUT"]
with wikidot.Client() as c:
    for site_name, slug in [("scp-wiki", "scp-9506"), ("scp-wiki", "scp-3352")]:
        s = c.site.get(site_name)
        pg = s.page.get(slug)
        votes = list(pg.votes)
        rows = []
        for v in votes:
            u = v.user
            rows.append({"user_id": getattr(u, "id", None), "name": getattr(u, "name", None), "value": v.value if hasattr(v,"value") else str(v)})
        pos = sum(1 for r in rows if r["value"] == 1); neg = sum(1 for r in rows if r["value"] == -1)
        print(slug, "page_id", pg.id, "rated_rows", len(rows), "pos", pos, "neg", neg, "rating", pg.rating)
        print("  sample", rows[:3])
        json.dump({"site": site_name, "slug": slug, "page_id": pg.id, "rating": pg.rating, "votes": rows}, open(os.path.join(OUT, f"votes-{slug}.json"), "w"), indent=1)
