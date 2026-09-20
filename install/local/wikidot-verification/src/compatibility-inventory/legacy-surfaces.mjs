import { discoverFramerailAmc as discoverFramerailAmcFromSource } from "./framerail-amc.mjs"
import { phase, surface } from "./catalog-surfaces.mjs"
import { extractBalanced, objectPropertyNames } from "./typescript-source.mjs"

export async function discoverFramerailAmc(root, { readText, readJson }) {
  return discoverFramerailAmcFromSource(root, {
    readText: (selectedRoot, relativePath) => readText(selectedRoot, relativePath),
    readJson: (selectedRoot, relativePath) => readJson(selectedRoot, relativePath),
    surface
  })
}

const FRAMERAIL_AMC_TEST_PATH = "framerail/tests/ajax-module-connector.test.js"
const FRAMERAIL_AMC_TESTS = new Map([
  [
    "framerail-amc-action:ForumAction:createPageDiscussionThread",
    [
      "dispatches Wikidot page discussion creation and preserves its wire envelope",
      "page discussion creation uses Wikidot no_page and stable failure boundaries"
    ]
  ],
  [
    "framerail-amc-action:misc/NewPageHelperAction:createNewPage",
    [
      "dispatches NewPage helper default action with Wikidot edit-routing fields",
      "dispatches NewPage template and category action fields like Wikidot"
    ]
  ],
  [
    "framerail-amc-module:changes/SiteChangesListModule:parameters=categoryId,options,page,pageId,perpage",
    ["dispatches the sealed SiteChanges control-browser-shape matrix with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:changes/SiteChangesListModule:parameters=options,page,perpage",
    ["SiteChanges accepts wikidot.py client-page-one-default without browser host fields"]
  ],
  [
    "framerail-amc-module:files/PageFilesModule:parameters=page_id",
    ["dispatches wikidot.py page reads without rewriting their request fields"]
  ],
  [
    "framerail-amc-module:forum/ForumCommentsListModule:parameters=order,pageId",
    ["dispatches the sealed page comments reads without adding mutation authority"]
  ],
  [
    "framerail-amc-module:forum/ForumCommentsListModule:parameters=pageId",
    ["dispatches the sealed page comments reads without adding mutation authority"]
  ],
  [
    "framerail-amc-module:forum/ForumRecentPostsListModule:parameters=categoryId,page",
    ["dispatches the sealed read-only forum modules with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:forum/ForumStartModule:parameters=(none)",
    ["dispatches the sealed read-only forum modules with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:forum/ForumStartModule:parameters=hidden",
    ["dispatches the sealed read-only forum modules with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:forum/ForumViewCategoryModule:parameters=c,p",
    ["dispatches the sealed read-only forum modules with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:forum/ForumViewThreadModule:parameters=t",
    ["dispatches the sealed read-only forum modules with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:forum/ForumViewThreadPostsModule:parameters=pageNo,t",
    ["dispatches the sealed read-only forum modules with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:history/PageRevisionListModule:parameters=options,page_id,perpage",
    ["dispatches the exact wikidot.py page revision list shape"]
  ],
  [
    "framerail-amc-module:history/PageSourceModule:parameters=revision_id",
    ["dispatches the exact wikidot.py historical source and version shapes"]
  ],
  [
    "framerail-amc-module:history/PageVersionModule:parameters=revision_id",
    ["dispatches the exact wikidot.py historical source and version shapes"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:duplicate-fields=last_value",
    ["ListPages keeps the later URL-form value for duplicate scalar fields", "ListPages keeps later module names while other modules reject duplicates"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:authentication=cookies_ignored;wikidot_token7_accepted_ignored",
    ["ListPages validates the public token but excludes controls from render parameters"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:callback-index=accepted_ignored",
    ["ListPages validates the public token but excludes controls from render parameters"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:failure-envelopes=render_failure:status=not_ok;message=Unable to render ListPages module",
    ["converts Deepwell failures to a stable Wikidot error envelope"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:parameter-order=insignificant",
    ["ListPages validates the public token but excludes controls from render parameters"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:parameters=category,created_at,created_by,createdat,createdby,full_slug,fullname,fullslug,limit,name,offset,order,p,page-type,page_type,pagetype,parent,per_page,perpage,range,rating,rss,rssdescription,rsshome,rsslimit,rssonly,rsstitle,score,separate,tag,tags,updated_at,updatedat,wrapper;module_body=optional_default_template",
    ["dispatches ListPages forms and returns the Wikidot JSON envelope", "ListPages omits module_body for Deepwell's default row template"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:unknown-parameters=non_data_form_ignored;leading_underscore_rejected",
    ["ListPages ignores unknown non-data-form selectors while recognized selectors apply", "ListPages retains fail-closed boundaries for dynamic selectors and invalid UTF-8"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:success-envelope=status=ok;body=string",
    ["dispatches ListPages forms and returns the Wikidot JSON envelope"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:value-type=urlencoded_utf8_string",
    ["dispatches ListPages forms and returns the Wikidot JSON envelope"]
  ],
  [
    "framerail-amc-module:membership/MembersListModule:parameters=group,order,page",
    ["dispatches only the observed MembersListModule read shape"]
  ],
  [
    "framerail-amc-module:membership/MembersListModule:parameters=group,page",
    ["accepts the wikidot.py MembersList default and applies Wikidot joined order"]
  ],
  [
    "framerail-amc-module:pagerate/WhoRatedPageModule:parameters=pageId",
    ["dispatches only the canonical wikidot.py WhoRated shape"]
  ],
  [
    "framerail-amc-module:viewsource/ViewSourceModule:parameters=page_id",
    [
      "dispatches wikidot.py page reads without rewriting their request fields",
      "returns the observed no_page envelope for a missing ViewSource page"
    ]
  ]
])

export function applyFramerailAmcTests(root, records, sourceRevision, helpers) {
  const { preloadPinnedRevisionTexts, gitRevisionContains } = helpers
  const recordIds = new Set(records.map(({ surface_id: surfaceId }) => surfaceId))
  for (const surfaceId of FRAMERAIL_AMC_TESTS.keys()) {
    if (!recordIds.has(surfaceId)) {
      throw new Error(`Framerail AMC test mapping targets an unknown surface: ${surfaceId}`)
    }
  }
  preloadPinnedRevisionTexts(root, sourceRevision, [FRAMERAIL_AMC_TEST_PATH])
  let linked = 0
  const projected = records.map((record) => {
    const testNames = FRAMERAIL_AMC_TESTS.get(record.surface_id) ?? []
    for (const testName of testNames) {
      if (!gitRevisionContains(root, sourceRevision, FRAMERAIL_AMC_TEST_PATH, testName)) {
        throw new Error(`stale Framerail AMC public test: ${record.surface_id} -> ${testName}`)
      }
    }
    if (testNames.length > 0) linked += 1
    return {
      ...record,
      existing_refs: {
        ...record.existing_refs,
        tests: testNames.map((testName) => `${FRAMERAIL_AMC_TEST_PATH}#${testName}`)
      }
    }
  })
  if (linked !== 29 || projected.length - linked !== 0) {
    throw new Error("Framerail AMC public-test coverage counts drifted")
  }
  return projected
}

export async function discoverWikidotPyAmc(root, wikidotPySource, helpers) {
  const { readJson, verifyPinnedWikidotPySource, pinnedWikidotPyAmcModules } = helpers
  const contractPath = "docs/development/wikidot-py-amc-client-parity.json"
  const contract = await readJson(root, contractPath)
  if (contract.schema !== "wikijump.wikidot_py_amc_client_parity.v1") {
    throw new Error(`unknown Wikidot.py AMC contract schema: ${contract.schema}`)
  }
  const objects = contract.source?.objects
  const objectPaths = Array.isArray(objects) ? objects.map(({ path: objectPath }) => objectPath) : []
  if (
    contract.source?.repository !== wikidotPySource.repository ||
    contract.source?.commit !== wikidotPySource.commit ||
    contract.source?.root_tree !== wikidotPySource.root_tree ||
    !Array.isArray(objects) ||
    objects.length !== wikidotPySource.objects.size ||
    new Set(objectPaths).size !== objectPaths.length ||
    objects.some(({ path: objectPath, type, oid }) => {
      const expected = wikidotPySource.objects.get(objectPath)
      return expected?.[0] !== type || expected?.[1] !== oid
    })
  ) {
    throw new Error(`${contractPath} source identity drift`)
  }
  if (!Array.isArray(contract.modules)) {
    throw new Error(`${contractPath} modules must be an array`)
  }
  verifyPinnedWikidotPySource(wikidotPySource)
  const moduleNames = contract.modules.map(({ module_name: moduleName }) => moduleName)
  if (
    new Set(moduleNames).size !== moduleNames.length ||
    JSON.stringify([...new Set(moduleNames)].sort()) !== JSON.stringify(pinnedWikidotPyAmcModules(wikidotPySource))
  ) {
    throw new Error(`${contractPath} module denominator drift`)
  }

  return contract.modules.map((module) => {
    if (typeof module.module_name !== "string" || module.module_name === "") {
      throw new Error(`${contractPath} contains a module without module_name`)
    }
    if (
      !Array.isArray(module.parameters) ||
      module.parameters.some((parameter) => typeof parameter !== "string")
    ) {
      throw new Error(`${contractPath} ${module.module_name} parameters must be strings`)
    }
    if (!["supported", "unsupported_unevidenced"].includes(module.status)) {
      throw new Error(
        `${contractPath} ${module.module_name} has unknown status: ${module.status}`
      )
    }
    if (module.status === "unsupported_unevidenced" && !module.gap) {
      throw new Error(`${contractPath} ${module.module_name} has no actionable gap`)
    }
    const shape = module.parameters.length === 0 ? "(none)" : module.parameters.join(",")
    return surface({
      surfaceId: `wikidot-py-amc-module:${module.module_name}:parameters=${shape}`,
      kind: "wikidot_py_amc_module_shape",
      publicOwner: "Rokurolize/wikidot.py",
      publicReference: [
        `${contractPath}#module:${module.module_name};parameters=${shape}`
      ],
      tests:
        module.status === "supported"
          ? [
              "install/local/wikidot-verification/tests/wikidot-py-amc-client-parity.test.mjs#supported wikidot.py request bodies behave identically when only the target changes"
            ]
          : [],
      evidence: phase("partial", [contractPath]),
      source: phase(module.status === "supported" ? "implemented" : "pending")
    })
  })
}

export async function discoverFramerailXmlRpc(root, { readText }) {
  const registryPath = "framerail/src/lib/server/xmlrpc/methods.ts"
  const sourceText = await readText(root, registryPath)
  const marker = /const\s+METHOD_DEFINITIONS\b/u.exec(sourceText)
  if (!marker) throw new Error(`missing METHOD_DEFINITIONS in ${registryPath}`)
  const equals = sourceText.indexOf("=", marker.index + marker[0].length)
  const objectStart = sourceText.indexOf("{", equals + 1)
  if (equals < 0 || objectStart < 0) throw new Error(`invalid METHOD_DEFINITIONS in ${registryPath}`)
  const definition = extractBalanced(sourceText, objectStart, "{", "}")
  const methods = objectPropertyNames(definition, `${registryPath}#METHOD_DEFINITIONS`)
  if (methods.length === 0) throw new Error(`${registryPath} declares no XML-RPC methods`)
  return methods.map((method) =>
    surface({
      surfaceId: `framerail-xmlrpc:${method}`,
      kind: "framerail_xmlrpc_method",
      publicOwner: "framerail",
      publicReference: [`${registryPath}#method:${method}`]
    })
  )
}

