// All user-facing UI text lives here (Persian). To add German/Turkish later, add another
// dictionary with the same keys and pick one in app.js.
export const fa = {
  appName: 'مدیریت سوپرمارکت',
  demoBanner: 'حالت نمونه: همهٔ داده‌ها ساختگی است و به داده‌های واقعی فروشگاه ربطی ندارد.',
  tabs: { home: 'خانه', products: 'کالاها', stock: 'موجودی', orders: 'سفارش', reports: 'گزارش' },
  settings: 'تنظیمات',
  save: 'ذخیره', cancel: 'انصراف', close: 'بستن', delete: 'حذف', edit: 'ویرایش', add: 'افزودن', search: 'جستجو (نام یا بارکد)',
  noData: 'هنوز داده‌ای ثبت نشده.',
  units: { Stk: 'عدد (Stk)', kg: 'کیلو (kg)', l: 'لیتر (l)', Pkg: 'بسته (Pkg)' },
  moveTypes: { receive: 'ورود کالا', sale: 'فروش', waste: 'ضایعات', adjust: 'اصلاح موجودی' },
  level: { out: 'تمام شده', low: 'کم‌موجود', expired: 'منقضی', soon: 'نزدیک انقضا' },
  errors: {
    name_required: 'حداقل یکی از نام‌ها (آلمانی یا ترکی) لازم است.',
    barcode_invalid: 'بارکد باید فقط عدد و بین ۶ تا ۱۴ رقم باشد.',
    barcode_duplicate: 'این بارکد قبلاً برای کالای دیگری ثبت شده.',
    buy_price_invalid: 'قیمت خرید نامعتبر است.',
    sell_price_invalid: 'قیمت فروش نامعتبر است.',
    price_invalid: 'قیمت نامعتبر است.',
    unit_invalid: 'واحد نامعتبر است.',
    stock_invalid: 'موجودی (stock) نامعتبر است؛ باید عدد صفر یا بزرگ‌تر باشد.',
    min_stock_invalid: 'حداقل موجودی نامعتبر است.',
    pack_size_invalid: 'اندازهٔ بسته باید بزرگ‌تر از صفر باشد.',
    supplier_not_found: 'تأمین‌کننده پیدا نشد.',
    product_not_found: 'کالا پیدا نشد.',
    branch_not_found: 'شعبه پیدا نشد.',
    date_invalid: 'تاریخ نامعتبر است.',
    expiry_invalid: 'تاریخ انقضا نامعتبر است.',
    type_invalid: 'نوع رکورد نامعتبر است.',
    qty_invalid: 'مقدار نامعتبر است (باید بزرگ‌تر از صفر باشد؛ فقط «اصلاح» می‌تواند منفی باشد).',
    qty_not_integer: 'برای واحد Stk یا Pkg مقدار باید عدد صحیح باشد.',
    insufficient_stock: 'موجودی کافی نیست. ابتدا ورود کالا یا اصلاح موجودی را ثبت کنید.',
    would_make_negative: 'حذف این رکورد موجودی را منفی می‌کند.',
    movement_not_found: 'رکورد پیدا نشد.',
    lead_time_invalid: 'زمان تحویل باید عدد صحیح بین ۰ تا ۶۰ روز باشد.',
    supplier_duplicate: 'تأمین‌کننده‌ای با این نام وجود دارد.',
    branch_duplicate: 'شعبه‌ای با این نام وجود دارد.',
    missing_name_column: 'ستون نام کالا (name یا Artikel) در فایل نیست.',
    missing_barcode_column: 'ستون بارکد (barcode یا EAN) در فایل نیست.',
    missing_qty_column: 'ستون مقدار (qty یا Menge) در فایل نیست.',
    no_rows: 'فایل ردیف داده ندارد.',
    invalid_data: 'فایل پشتیبان معتبر نیست.',
    workspace_mismatch: 'این فایل متعلق به فضای دیگری (نمونه/واقعی) است و وارد نمی‌شود.',
  },
};

export function errorText(code) {
  return fa.errors[code] ?? `خطا: ${code}`;
}
