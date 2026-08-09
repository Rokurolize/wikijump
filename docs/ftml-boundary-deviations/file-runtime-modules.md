# Deviation: file runtime module recognition

Shim: `expand_file_modules`, `FILES_MODULE_REGEX`, and `FLICKR_GALLERY_MODULE_REGEX` in `deepwell/src/services/render/file_modules.rs`.

Reason it lives in Wikijump: `Files` needs actor-aware page and file state, while the evidenced `FlickrGallery` PagePreview result depends on preview context. Those runtime decisions belong to Wikijump, but the current FTML interface does not deliver these modules as typed delayed requirements.

Why FTML is not yet sufficient: FTML converts an unregistered module into its generic unknown-module result. It does not expose a typed generic module node or a caller disposition hook containing the authored head and literal-owner boundary.

Evidence: GitHub issue #1039; Files PagePreview raw HTML SHA-256 `d46ed3c8ce6c203f322f7608b264100811f6eb4b84f5f6fe78756e1b49ddfdd8`; saved empty Files HTML SHA-256 `bbfdc02ad6e8aabaee29ea0f31acea4c2eafabb18c6b384d5ff73589ea3ece75`; FlickrGallery PagePreview raw HTML SHA-256 `b63da96b39d3057e03f22ab85d048a6907d234e70a098685a6c47a2aca78714f`.

FTML backlog decision: this uses the same missing typed generic delayed-module boundary recorded by `runtime-module-residual-finalization.md`. It does not create a second parser framework or widen unsupported argument shapes.

Migration condition: FTML exposes typed delayed `Files` and `FlickrGallery` requirements with exact source ownership, after which Deepwell consumes those requirements and deletes both regular expressions and their literal-region scan.

Owner: Rokurolize.

Review trigger: every FTML pin bump that changes module parsing, and any FTML change that introduces a generic or file-module delayed node.
