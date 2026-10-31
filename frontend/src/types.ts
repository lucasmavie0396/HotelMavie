export type UserRole = 'ADMIN' | 'MANAGER' | 'RECEPTION';

export type RoomStatus = 'AVAILABLE' | 'OCCUPIED' | 'CLEANING' | 'MAINTENANCE';

export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';

export type ReservationSource = 'DESK' | 'PHONE' | 'EMAIL' | 'ONLINE';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  hotelId: number | null;
}

export interface Hotel {
  id: number;
  name: string;
  publicSlug: string | null;
  publicEnabled: boolean;
  customDomain: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  currency: string;
  legalName: string | null;
  taxId: string | null;
  invoiceFooter: string | null;
  accommodationTaxRateId: number | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  ticketFooter: string | null;
  logoFile: string | null;
  publicDescription: string | null;
  publicDescriptionEn: string | null;
  depositPercent: string;
  paymentInstructions: string | null;
  paymentInstructionsEn: string | null;
}

export interface RoomImage {
  id: number;
  file: string;
  sortOrder: number;
}

export interface Room {
  id: number;
  hotelId: number;
  number: string;
  type: string;
  capacity: number;
  pricePerNight: string;
  status: RoomStatus;
  floor: number | null;
  description: string | null;
  descriptionEn: string | null;
  images: RoomImage[];
}

export interface Guest {
  id: number;
  hotelId: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  documentType: string | null;
  documentNumber: string | null;
  nationality: string | null;
  birthDate: string | null;
  address: string | null;
  taxId: string | null;
  notes: string | null;
}

export interface Reservation {
  id: number;
  code: string;
  hotelId: number;
  guestId: number;
  roomId: number;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  status: ReservationStatus;
  source: ReservationSource;
  pricePerNight: string;
  totalAmount: string;
  notes: string | null;
  guest: Pick<Guest, 'id' | 'firstName' | 'lastName' | 'email' | 'phone' | 'nationality' | 'documentType' | 'documentNumber' | 'birthDate'>;
  room: Pick<Room, 'id' | 'number' | 'type'>;
  depositAmount: string | null;
  depositReference: string | null;
  depositPaymentTypeId: number | null;
  depositPaymentId: number | null;
  depositConfirmedAt: string | null;
  depositPaymentType: { id: number; name: string } | null;
  depositConfirmedBy: { name: string } | null;
  companions: Companion[];
}

export interface Companion {
  id: number;
  firstName: string;
  lastName: string;
  isChild: boolean;
  birthDate: string | null;
  nationality: string | null;
  documentType: string | null;
  documentNumber: string | null;
}

export const DOCUMENT_TYPES = ['BI', 'Passaporte', 'DIRE', 'Carta de conducao', 'Cartao de cidadao', 'Outro'];

export interface DashboardSummary {
  rooms: Record<RoomStatus, number>;
  totalRooms: number;
  inHouse: number;
  occupancy: number;
  arrivals: Reservation[];
  departures: Reservation[];
  kpis: {
    arrivalsToday: number;
    departuresToday: number;
    pendingRequests: number;
    pendingDeposits: number;
    openOrders: number;
    openSessions: number;
    revenueToday: string | null;
  };
  forecast: { date: string; confirmed: number; pending: number; arrivals: number; departures: number; occupancy: number }[];
  revenue: { date: string; accommodation: string; restaurant: string; bar: string; extra: string }[] | null;
  sources: { source: ReservationSource; count: number }[];
}

export interface PublicRoomType {
  type: string;
  capacity: number;
  pricePerNight: string;
  description: string | null;
  descriptionEn: string | null;
  available: number;
  images: string[];
  nights?: number;
  total?: string;
  deposit?: string;
}

export interface PublicHotel
  extends Pick<Hotel, 'name' | 'publicSlug' | 'email' | 'phone' | 'address' | 'city' | 'currency' | 'logoFile' | 'publicDescription' | 'publicDescriptionEn' | 'paymentInstructions' | 'paymentInstructionsEn'> {
  depositPercent: number;
  paymentTypes: { id: number; name: string; requiresReference: boolean }[];
  roomTypes: PublicRoomType[];
}

export type ChargeType = 'ACCOMMODATION' | 'RESTAURANT' | 'BAR' | 'EXTRA';
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'MOBILE' | 'OTHER';
export type InvoiceType = 'INVOICE' | 'INVOICE_RECEIPT' | 'CREDIT_NOTE' | 'RECEIPT';

export interface TaxRate {
  id: number;
  hotelId: number;
  name: string;
  rate: string;
  exemptionReason: string | null;
  exemptionCode: string | null;
  atCategory: 'RED' | 'INT' | 'NOR' | 'ISE';
  active: boolean;
}

export interface Charge {
  id: number;
  type: ChargeType;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  total: string;
  invoiceId: number | null;
  invoice: { id: number; fullNumber: string } | null;
  onCustomerAccount?: boolean;
  createdAt: string;
}

export interface Payment {
  id: number;
  amount: string;
  method: PaymentMethod;
  paymentTypeId?: number | null;
  reference: string | null;
  createdAt: string;
  reservation?: { id: number; code: string } | null;
}

export interface InvoiceSummary {
  id: number;
  fullNumber: string;
  type: InvoiceType;
  status: 'ISSUED' | 'CREDITED';
  grossTotal: string;
  issuedAt: string;
  customerName?: string;
  customerTaxId?: string | null;
  currency?: string;
  reservationId?: number | null;
}

export interface Folio {
  charges: Charge[];
  payments: Payment[];
  invoices: InvoiceSummary[];
  chargesTotal: string;
  paymentsTotal: string;
  balance: string;
  customerAccountTotal: string;
  pendingAccommodation: string;
}

export interface CashSession {
  id: number;
  registerId: number;
  openedAt: string;
  openingAmount: string;
  closedAt: string | null;
  expectedAmount: string | null;
  countedAmount: string | null;
  difference: string | null;
  notes: string | null;
  openedById?: number | null;
  openedBy?: { name: string } | null;
  closedBy?: { name: string } | null;
}

export interface CashRegister {
  id: number;
  name: string;
  sessions: CashSession[];
}

export interface CashSessionDetail extends CashSession {
  register: { id: number; name: string };
  payments: Payment[];
  movements: { id: number; type: 'IN' | 'OUT'; amount: string; description: string; createdAt: string; createdBy: { name: string } | null }[];
  expected: string;
}

export type Outlet = 'RESTAURANT' | 'BAR';

export interface DiningTable {
  id: number;
  hotelId: number;
  outlet: Outlet;
  number: number;
  name: string | null;
  seats: number;
  active: boolean;
  label: string;
  openOrder: { id: number; total: string; openedAt: string; items: number; pending: number; checks: number } | null;
}
export type PrepStation = 'KITCHEN' | 'BAR' | 'NONE';

export interface ProductCategory {
  id: number;
  name: string;
  outlet: Outlet | null;
  prepStation: PrepStation;
  printerId: number | null;
  sortOrder: number;
}

export interface Product {
  id: number;
  categoryId: number | null;
  category: Pick<ProductCategory, 'id' | 'name' | 'outlet'> | null;
  name: string;
  sku: string | null;
  unit: string;
  price: string;
  cost: string;
  taxRateId: number | null;
  sellable: boolean;
  trackStock: boolean;
  trackExpiry: boolean;
  minStock: string;
  active: boolean;
  imageFile: string | null;
}

export interface ImageSearchResult {
  title: string;
  url: string;
  thumb: string;
  source: string | null;
  license: string | null;
  author: string | null;
}

export interface Warehouse {
  id: number;
  name: string;
  isDefault: boolean;
}

export interface StockLevelRow extends Product {
  quantity: string;
  belowMinimum: boolean;
}

export interface StockMovement {
  id: number;
  type: 'PURCHASE' | 'SALE' | 'ADJUSTMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'WASTE' | 'RETURN';
  quantity: string;
  balance: string;
  reason: string | null;
  createdAt: string;
  product: { name: string; unit: string };
  warehouse: { name: string };
  createdBy: { name: string } | null;
  document: { id: number; type: StockDocumentType; year: number | null; number: number | null } | null;
  purchase: { id: number; supplierRef: string | null } | null;
}

export type StockDocumentType = 'INVENTORY' | 'WASTE' | 'TRANSFER' | 'RETURN';

export interface StockLot {
  id: number;
  productId: number;
  code: string | null;
  expiryDate: string | null;
  quantity: string;
  product: { id: number; name: string; unit: string };
}

export interface StockDocument {
  id: number;
  type: StockDocumentType;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  year: number | null;
  number: number | null;
  reason: string | null;
  createdAt: string;
  postedAt: string | null;
  warehouse: { id: number; name: string };
  toWarehouse: { id: number; name: string } | null;
  supplier: { id: number; name: string } | null;
  createdBy: { name: string } | null;
  items: { id: number; productId: number; quantity: string; previousQuantity: string | null; product: { name: string; unit: string } }[];
}

export interface Supplier {
  id: number;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
}

export interface Purchase {
  id: number;
  status: 'DRAFT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
  supplierRef: string | null;
  total: string;
  orderedAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  supplier: { id: number; name: string; email: string | null };
  warehouse: { id: number; name: string };
  items: {
    id: number;
    productId: number;
    quantity: string;
    receivedQuantity: string;
    unitCost: string;
    total: string;
    product: { name: string; unit: string; trackExpiry: boolean };
  }[];
}

export interface PurchaseSuggestion {
  productId: number;
  name: string;
  unit: string;
  quantity: string;
  minStock: string;
  pending: string;
  suggested: string;
  unitCost: string;
  supplier: { id: number; name: string } | null;
}

export interface OrderItem {
  id: number;
  productId: number;
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  notes: string | null;
  sentAt: string | null;
  readyAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: { name: string } | null;
  product: { category: { prepStation: PrepStation } | null };
}

export interface AuditLog {
  id: number;
  action: string;
  entity: string;
  entityId: number | null;
  summary: string;
  createdAt: string;
  user: { id: number; name: string } | null;
}

export interface BackupStatus {
  enabled: boolean;
  hour: number | null;
  keepDays: number;
  copyDir: string | null;
  nextRunAt: string | null;
  lastRun: { at: string; ok: boolean; file?: string; copied?: boolean; error?: string } | null;
}

export interface KdsCard {
  key: string;
  orderId: number;
  table: string;
  outlet: Outlet;
  waiter: string | null;
  sentAt: string;
  readyAt: string | null;
  items: { id: number; quantity: string; description: string; notes: string | null; voided: boolean; readyAt: string | null }[];
}

export interface Order {
  id: number;
  outlet: Outlet;
  tableLabel: string | null;
  tableId: number | null;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  total: string;
  openedAt: string;
  closedAt: string | null;
  items: OrderItem[];
  reservation: { id: number; code: string; room: { number: string } } | null;
  openedBy: { name: string } | null;
  charges: { id: number; invoice: { id: number; fullNumber: string } | null }[];
}

export interface OpenInvoice {
  id: number;
  fullNumber: string;
  issuedAt: string;
  customerName: string;
  customerTaxId: string | null;
  grossTotal: string;
  settled: string;
  open: string;
  customerKey: string;
}

export interface CustomerAccount {
  customerKey: string;
  customerName: string;
  customerTaxId: string | null;
  open: string;
  invoices: number;
  oldest: string;
}

export interface ReceiptDoc {
  id: number;
  fullNumber: string;
  status: 'ISSUED' | 'CANCELLED';
  issuedAt: string;
  customerName: string;
  customerTaxId: string | null;
  amount: string;
  method: PaymentMethod;
  paymentTypeId?: number | null;
  reference: string | null;
  cancelReason: string | null;
  lines: { id: number; amount: string; invoice: { id: number; fullNumber: string } }[];
}
export type ContractType = 'PERMANENT' | 'FIXED_TERM' | 'PART_TIME' | 'INTERN' | 'OTHER';

export interface Employee {
  id: number;
  hotelId: number;
  userId: number | null;
  fullName: string;
  jobTitle: string;
  department: string | null;
  active: boolean;
  email?: string | null;
  phone?: string | null;
  taxId?: string | null;
  socialSecurityNumber?: string | null;
  iban?: string | null;
  contractType?: ContractType;
  startDate?: string;
  endDate?: string | null;
  weeklyHours?: string;
  baseSalary?: string | null;
  irsRate?: string;
  notes?: string | null;
  user?: { id: number; email: string } | null;
}

export interface PayrollSettings {
  employeeSsRate: string | number;
  employerSsRate: string | number;
  overtimeMultiplier: string | number;
  subsidiesInTwelfths: boolean;
  holidayPayMonth: number;
  christmasPayMonth: number;
}

export interface PayslipLine {
  label: string;
  amount: number;
  kind: 'EARNING' | 'DEDUCTION';
  taxable: boolean;
}

export interface Payslip {
  id: number;
  employeeId: number;
  fullName: string;
  jobTitle: string;
  baseSalary: string;
  hourlyRate: string;
  scheduledHours: string;
  workedHours: string;
  absenceHours: string;
  absenceDeduction: string;
  overtimeHours: string;
  overtimePay: string;
  holidayPay: string;
  christmasPay: string;
  otherEarnings: string;
  grossPay: string;
  ssBase: string;
  employeeSs: string;
  irsRate: string;
  irsWithholding: string;
  otherDeductions: string;
  netPay: string;
  employerSs: string;
  extraLines: PayslipLine[] | null;
  notes: string | null;
  manual: boolean;
}

export interface PayrollRun {
  id: number;
  year: number;
  month: number;
  status: 'DRAFT' | 'CLOSED';
  createdAt: string;
  closedAt: string | null;
  createdBy: { name: string } | null;
  payslips: Payslip[];
}

export interface Shift {
  id: number;
  employeeId: number;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  notes: string | null;
  employee: { id: number; fullName: string; jobTitle: string };
}

export interface TimeEntry {
  id: number;
  employeeId: number;
  clockIn: string;
  clockOut: string | null;
  source: 'SELF' | 'MANAGER';
  notes: string | null;
  editedAt: string | null;
  employee: { id: number; fullName: string };
  editedBy: { name: string } | null;
}

export interface MonthlyRow {
  employeeId: number;
  fullName: string;
  jobTitle: string;
  scheduledShifts: number;
  scheduledMinutes: number;
  workedDays: number;
  workedMinutes: number;
  differenceMinutes: number;
  openEntries: number;
  editedEntries: number;
}

export type PrinterPurpose = 'RECEIPT' | 'KITCHEN' | 'BAR' | 'OTHER';
export type PaperWidth = 'MM58' | 'MM80' | 'A4';

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  group: string;
  params: 'period' | 'date' | 'stock' | 'none';
}

export interface ReportDocument {
  key: string;
  title: string;
  period: string;
  generatedAt: string;
  generatedBy: string;
  hotel: Hotel;
  sections: {
    title: string;
    kpis?: { label: string; value: string }[];
    table?: { columns: { label: string; align?: 'left' | 'right' | 'center'; weight?: number }[]; rows: string[][]; totals?: string[]; empty?: string };
    note?: string;
  }[];
}
export type PrinterConnection = 'BROWSER' | 'NETWORK' | 'LOCAL';
export type PrinterOutput = 'DIRECT' | 'PDF';

export interface Printer {
  id: number;
  name: string;
  purpose: PrinterPurpose;
  connection: PrinterConnection;
  host: string | null;
  port: number;
  localName: string | null;
  paperWidth: PaperWidth;
  output: PrinterOutput;
  copies: number;
  isDefault: boolean;
  active: boolean;
}

export interface PaymentType {
  id: number;
  name: string;
  kind: PaymentMethod;
  mechanism: string | null;
  requiresReference: boolean;
  active: boolean;
  sortOrder: number;
}