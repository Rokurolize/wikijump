import os, re, time, json, urllib.request, urllib.error, wikidot
from wikidot.connector.ajax import AjaxModuleConnectorConfig
SITE = "sandbox-for-codex"
STAMP = str(int(time.time())); TAG = f"wjt{STAMP}"; PFX = f"wj2680-{STAMP}"
OUT = os.environ["PROBE_OUT"]
cfg = AjaxModuleConnectorConfig(allow_insecure_session_transport_for=SITE)
def lp(inner): return f'[[module ListPages category="*" tags="+{TAG}" limit="5" separate="false"]]\n{inner}\n[[/module]]'
HOLD = {
  "mid": lp('Row %%title_linked%%\n[[html]]\n<div class="h1">A %%tags%% | %%created_by%%</div>\n[[/html]]'),
  "lead": lp('[[html]]\n<div class="h2">B %%tags%%</div>\n[[/html]]\nRow %%title_linked%%'),
}
created = []
def get(url):
    try:
        r = urllib.request.urlopen(url, timeout=60); return r.status, r.headers.get("Content-Type"), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type"), e.read().decode("utf-8", "replace")
with wikidot.Client(username=os.environ["WIKIDOT_USERNAME"], password=os.environ["WIKIDOT_PASSWORD"], amc_config=cfg) as c:
    s = c.site.get(SITE)
    try:
        for name, tags in [("t1", [TAG, "x<i>y"]), ("t2", [TAG, 'q"t'])]:
            s.page.publish(fullname=f"{PFX}-{name}", title=f"Target {name}", source=f"target {name}", comment="run-owned probe", tags=tags, verify_source=True)
            created.append(f"{PFX}-{name}")
            pg = s.page.get(f"{PFX}-{name}")
            print("tags read back", name, [repr(t) for t in (pg.tags or [])])
        for name, src in HOLD.items():
            s.page.publish(fullname=f"{PFX}-{name}", title=f"Holder {name}", source=src, comment="run-owned probe", verify_source=True)
            created.append(f"{PFX}-{name}")
        time.sleep(3)
        for name in HOLD:
            url = f"http://{SITE}.wikidot.com/{PFX}-{name}"
            st, ct, html = get(url)
            open(os.path.join(OUT, f"{PFX}-{name}.html"), "w").write(html)
            srcs = re.findall(r'<iframe src="([^"]+)"', html)
            print(name, "page", st, "iframes", srcs)
            for src in srcs:
                base = f"http://{SITE}.wikidot.com"
                try:
                    st2, ct2, body = get(base + src)
                    open(os.path.join(OUT, f"{PFX}-{name}-hosted.html"), "w").write(body); print("  hosted", st2, len(body))
                except Exception as e:
                    print("  hosted-err", type(e).__name__, str(e)[:120])
    finally:
        for slug in created:
            try:
                s.page.get(slug).destroy(); print("deleted", slug)
            except Exception as e:
                print("cleanup-fail", slug, type(e).__name__, str(e)[:120])
