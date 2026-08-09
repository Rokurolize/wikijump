export interface PendingBlobUpload {
  pending_blob_id: string
  presign_url: string
}

interface PendingBlobUploadLifecycle<T> {
  start: () => PromiseLike<PendingBlobUpload>
  upload: (presignUrl: string) => PromiseLike<void>
  commit: (pendingBlobId: string) => PromiseLike<T>
  cancel: (pendingBlobId: string) => PromiseLike<void>
}

export async function commitPendingBlobUpload<T>({
  start,
  upload,
  commit,
  cancel
}: PendingBlobUploadLifecycle<T>): Promise<T> {
  let pending: PendingBlobUpload | undefined
  try {
    pending = await start()
    await upload(pending.presign_url)
    return await commit(pending.pending_blob_id)
  } catch (error) {
    if (pending) {
      try {
        await cancel(pending.pending_blob_id)
      } catch {
        console.error("Unable to cancel a failed pending blob upload")
      }
    }
    throw error
  }
}
