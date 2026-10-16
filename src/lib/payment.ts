import { Banknote, CreditCard, FileText, Landmark, MoreHorizontal, Smartphone, Zap, type LucideIcon } from 'lucide-react';
import type { PaymentMethod } from '../db/types';

export const PAYMENT_METHODS: { id: PaymentMethod; label: string; short: string; icon: LucideIcon }[] = [
  { id: 'cash', label: 'Cash', short: 'Cash', icon: Banknote },
  { id: 'debit', label: 'Debit card', short: 'Debit', icon: CreditCard },
  { id: 'credit', label: 'Credit card', short: 'Credit', icon: CreditCard },
  { id: 'online', label: 'Online / UPI', short: 'Online', icon: Zap },
  { id: 'transfer', label: 'Bank transfer', short: 'Transfer', icon: Landmark },
  { id: 'wallet', label: 'Wallet app', short: 'Wallet', icon: Smartphone },
  { id: 'cheque', label: 'Cheque', short: 'Cheque', icon: FileText },
  { id: 'other', label: 'Other', short: 'Other', icon: MoreHorizontal },
];
export const methodInfo = (id?: string) => PAYMENT_METHODS.find((m) => m.id === id);
