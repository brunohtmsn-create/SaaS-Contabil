export type UploadResult = {
  s3Key: string
  bucket: string
  url: string
  size: number
  hash: string
}

export type DownloadResult = {
  data: Buffer
  contentType: string
  size: number
}
