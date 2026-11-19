export async function startBlobUpload() {
  return { presign_url: "http://localhost/presign", pending_blob_id: "stub-blob" }
}

export async function uploadToPresignUrl() {
  return {}
}
