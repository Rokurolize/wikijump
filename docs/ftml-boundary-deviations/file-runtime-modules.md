# Deviation: file runtime module recognition

Shim: `expand_file_modules`, `FILES_MODULE_REGEX`, and `FLICKR_GALLERY_MODULE_REGEX` in `deepwell/src/services/render/file_modules.rs`.

Reason it lives in Wikijump: `Files` needs actor-aware page and file state, while the evidenced `FlickrGallery` PagePreview result depends on preview context. Those runtime decisions belong to Wikijump, but the frozen invocations are closer-less own-line module heads and the current FTML interface does not deliver that source shape as a typed delayed requirement.

Why FTML is not yet sufficient: the pinned FTML revision `324ac373ed0a3ee8dc46dbad5aa1d91688be95d6` exposes `Module::Runtime { name, arguments, body }` for an unregistered module only when it has a body closer on a later physical line. The frozen `[[module Files]]` and `[[module FlickrGallery]]` cases have no closer, so FTML still converts them into its generic unknown-module result instead of exposing the authored head and literal-owner boundary. The shim corrects that existing gap only for the exact argument-free source shapes; it must not grow into a second module parser.

Evidence: GitHub issue #1039; Files PagePreview raw HTML SHA-256 `d46ed3c8ce6c203f322f7608b264100811f6eb4b84f5f6fe78756e1b49ddfdd8`; saved empty Files HTML SHA-256 `bbfdc02ad6e8aabaee29ea0f31acea4c2eafabb18c6b384d5ff73589ea3ece75`; FlickrGallery PagePreview raw HTML SHA-256 `b63da96b39d3057e03f22ab85d048a6907d234e70a098685a6c47a2aca78714f`.

FTML backlog decision: this uses the closer-less portion of the typed runtime-module boundary recorded by `runtime-module-residual-finalization.md`. The newer body-bearing `Module::Runtime` variant does not make these two frozen cases migratable. This shim does not create a second parser framework or widen unsupported argument shapes.

Migration condition: FTML exposes closer-less `Files` and `FlickrGallery` invocations as typed delayed requirements with exact source ownership, after which Deepwell consumes those requirements and deletes both regular expressions and their literal-region scan.

Owner: Rokurolize.

Review trigger: every FTML pin bump that changes module parsing, and any FTML change that introduces a generic or file-module delayed node.
