export interface SaleLot {
  id?: string | null;
  quantity: number;
  cost_price: number;
  purchase_date?: string | null;
  is_closed?: boolean;
  closing_price?: number | null;
  closing_date?: string | null;
  stop_loss_set?: boolean;
  sale_id?: string;
}
export interface SalePosition extends SaleLot { purchase_lots?: SaleLot[] }
export interface SaleRequest {
  sale_id: string;
  quantity: number;
  price: number;
  date: string;
  lot_index?: number | null;
  expected_updated_at?: string | null;
}
export interface SalePlan {
  purchase_lots: SaleLot[];
  allocations: { lot_index: number; quantity: number; purchase_date: string; cost_price: number }[];
  proceeds: number;
  remaining_quantity: number;
}
export type SalePreview = Pick<SalePlan, 'allocations' | 'proceeds' | 'remaining_quantity'>;
