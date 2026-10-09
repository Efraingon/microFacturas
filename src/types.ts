export type Receipt = {
  id: string
  date: string
  receiptNumber: string
  location: string
  amount: number
  bank: string
  image: string
  createdAt: string
  ownerId: string | null
  synced: boolean
}

export type ReceiptDraft = Omit<Receipt, 'id' | 'createdAt' | 'ownerId' | 'synced'>
