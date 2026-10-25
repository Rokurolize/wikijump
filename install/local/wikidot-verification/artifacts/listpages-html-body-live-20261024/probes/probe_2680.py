import os, sys, json, time, urllib.request, wikidot
from wikidot.connector.ajax import AjaxModuleConnectorConfig
SITE = "sandbox-for-codex"
STAMP = str(int(time.time()))
TAG = f"wjt{STAMP}"
PFX = f"wj2680-{STAMP}"
OUT = os.environ["PROBE_OUT"]
cfg = AjaxModuleConnectorConfig(allow_insecure_session_transport_for=SITE)
created = []
def lp(tag, body_inner):
    return f'[[module ListPages category="*" tags="+{tag}" limit="5" separate="false"]]\n{body_inner}\n[[/module]]'
mid = lp(TAG, "Row %%title_linked%%\n[[html]]\n<div class=\"wjrow\">by %%created_by%% | tags: %%tags%%</div>\n[[/html]]")
lead = lp(TAG, "[[html]]\n<div class=\"wjlead\">lead</div>\n[[/html]]\nRow %%title_linked%%")
with wikidot.Client(username=os.environ["WIKIDOT_USERNAME"], password=os.environ["WIKIDOT_PASSWORD"], amc_config=cfg) as c:
    s = c.site.get(SITE)
    try:
        for name in ["t1", "t2"]:
            r = s.page.publish(fullname=f"{PFX}-{name}", title=f"Target {name}", source=f"target {name}", comment="run-owned probe", tags=[TAG], verify_source=True)
            created.append(f"{PFX}-{name}")
            print("created", name, r.as_dict().get("tags", "?") if hasattr(r, "as_dict") else r)
        for name, src in [("mid", mid), ("lead", lead)]:
            r = s.page.publish(fullname=f"{PFX}-{name}", title=f"Holder {name}", source=src, comment="run-owned probe", verify_source=True)
            created.append(f"{PFX}-{name}")
        # Tag with markup characters: does Wikidot accept it?
        for bad in ["<b>x</b>", 'q"t', "a[b]"]:
            try:
                p = s.page.publish(fullname=f"{PFX}-tagprobe", title="tag probe", source="x", comment="run-owned probe", tags=[bad], verify_source=True)
                created.append(f"{PFX}-tagprobe")
                print("tag accepted", repr(bad), p.as_dict() if hasattr(p, "as_dict") else p)
            except Exception as e:
                print("tag rejected", repr(bad), type(e).__name__, str(e)[:200])
        # Wait for render, then fetch anonymously
        time.sleep(3)
        for name in ["mid", "lead"]:
            url = f"http://{SITE}.wikidot.com/{PFX}-{name}"
            html = urllib.request.urlopen(url, timeout=60).read().decode("utf-8", "replace")
            open(os.path.join(OUT, f"{PFX}-{name}.html"), "w").write(html)
            print(name, "bytes", len(html), "iframes", html.count("<iframe"), "wjrow" in html, "wjlead" in html)
    finally:
        for slug in created:
            try:
                s.page.get(slug).destroy(); print("deleted", slug)
            except Exception as e:
                print("cleanup-fail", slug, type(e).__name__, str(e)[:120])
