import os, re, time, json, hashlib, urllib.request, urllib.error, wikidot
from wikidot.connector.ajax import AjaxModuleConnectorConfig
SITE = "sandbox-for-codex"
STAMP = str(int(time.time())); TAG = f"wjm{STAMP}"; PFX = f"wj2680m-{STAMP}"
OUT = os.environ["PROBE_OUT"]
cfg = AjaxModuleConnectorConfig(allow_insecure_session_transport_for=SITE)
def lp(inner): return f'[[module ListPages category="*" tags="+{TAG}" limit="5" separate="false"]]\n{inner}\n[[/module]]'
CASES = {
  "A-html-mid-after-prose": lp('Row %%title_linked%%\n[[html]]\n<div class="mA">A</div>\n[[/html]]'),
  "B-html-mid-after-two-prose-lines": lp('Row %%title_linked%%\nSecond line\n[[html]]\n<div class="mB">B</div>\n[[/html]]\nTail line'),
  "C-control-no-block": lp('Row %%title_linked%%\nSecond line'),
  "D-escaped-html-marker-mid": lp('Row %%title_linked%% @@[[html]]@@ literal\n@@[[/html]]@@'),
  "E-code-mid-after-prose": lp('Row %%title_linked%%\n[[code]]\n<b>E</b>\n[[/code]]'),
}
created = []
def get(url):
    try:
        r = urllib.request.urlopen(url, timeout=60); return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
summary = {}
with wikidot.Client(username=os.environ["WIKIDOT_USERNAME"], password=os.environ["WIKIDOT_PASSWORD"], amc_config=cfg) as c:
    s = c.site.get(SITE)
    try:
        for name in ["t1", "t2"]:
            s.page.publish(fullname=f"{PFX}-{name}", title=f"Target {name}", source=f"target {name}", comment="run-owned probe", tags=[TAG], verify_source=True)
            created.append(f"{PFX}-{name}")
        for key, src in CASES.items():
            slug = f"{PFX}-{key[0].lower()}"
            s.page.publish(fullname=slug, title=f"Holder {key}", source=src, comment="run-owned probe", verify_source=True)
            created.append(slug)
        time.sleep(3)
        for key in CASES:
            slug = f"{PFX}-{key[0].lower()}"
            st, html = get(f"http://{SITE}.wikidot.com/{slug}")
            open(os.path.join(OUT, f"matrix-{key}.html"), "w").write(html)
            i = html.find('id="page-content"'); j = html.find('</div>', html.find('list-pages-box', i))
            summary[key] = {
                "status": st,
                "iframes": len(re.findall(r'<iframe ', html)),
                "row_links": len(re.findall(r'<h1><span><a href="/' + re.escape(PFX) + r'-t\d"', html)),
                "rows_default_template": len(re.findall(r'<h1><span><a href="/' + re.escape(PFX) + r'-t\d"', html)),
                "literal_row_text": html.count("Row %%title_linked%%"),
                "literal_module_close": html.count("[[/module]]"),
                "literal_escaped_marker": html.count("@@[[html]]@@"),
                "code_tag_visible": "<b>E</b>" in html,
            }
            print(key, summary[key])
    finally:
        for slug in created:
            try:
                s.page.get(slug).destroy()
            except Exception as e:
                print("cleanup-fail", slug, type(e).__name__)
        print("cleanup done", len(created))
json.dump(summary, open(os.path.join(OUT, "matrix-summary.json"), "w"), indent=1)
