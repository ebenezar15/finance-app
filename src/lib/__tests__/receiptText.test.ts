import { describe, expect, it } from 'vitest';
import { readReceipt, receiptToMessage, wordsToPaise } from '../receiptText';
import { parseAlert } from '../sms';

/**
 * The fixtures are what the on-device reader (src/lib/ocr.ts: Tesseract, sparse-text mode, rows
 * rebuilt, rupee sign restored from the pixels) actually returned for rendered Google Pay, PhonePe,
 * Paytm and bank-app receipt screens, junk rows included. The "quirks" tests then damage them the
 * way raw Tesseract output is damaged when the rupee sign is not recovered.
 */
const GPAY_DARK = `10:42  5G alll 87%
RS
To Ramesh Stores
rameshstores@okhdfcbank
₹250
+) Completed
12 Nov 2026, 10:42 am
HDFC Bank 1234
UPI transaction ID
431298765432
To: RAMESH STORES
Google Pay « rameshstores@okhdfcbank
From: PRIYA SHARMA (HDFC Bank)
Google Pay « priyasharma@okhdfcbank
Google transaction ID
CICAgKDLx8nVZQ
POWERED BY UPI
Having issues?  Share screenshot`;

const GPAY_RECEIVED = `10:42  5G mill 87%
From Meera Nair
meeranair@okicici
₹3,500
© Completed
9 Nov 2026, 4:20 pm
HDFC Bank 1234
UPI transaction ID
431055667788
To: PRIYA SHARMA
Google Pay « priyasharma@okhdfcbank
From: MEERA NAIR
Google Pay » meeranair@okicici
Google transaction ID
CICAgKDLx8nVZQ
pPowERED BY UPI`;

const GPAY_OLD = `10:42  5G oll 87%
₹480
Paid to Hotel Saravana Bhavan
saravanabhavan@okaxis
Q Completed
8 Nov 2026, 1:32 pm
HDFC Bank 1234
UPI transaction ID
430911223344
To: HOTEL SARAVANA BHAVAN
Google Pay e saravanabhavan@okaxis
From: PRIYA SHARMA (HDFC Bank)
Google Pay e priyasharma@okhdfcbank
Google transaction ID
CICAgKDLX8nVZQ
POWERED BY UPI`;

const PHONEPE_LIGHT = `10:42  5G ull 87%
Transaction Successful
10:42 am on 12 Nov 2026
Paid to
Ramesh Stores
₹250
®
rameshstores@ybl
Banking Name : RAMESH STORES
E Transfer Details
Transaction ID
T2611121042301234567890  COPY
Debited from
iB XXXXXX1234  ₹250
UTR: 431298765432 COPY
2
4  [¢]  i)
2
Send Again  View History Split Expense  Share Receipt
? Contact PhonePe Support
Powered by UPI | YES BANK`;

// Dark PhonePe: the green header was not read at all, and the avatar's initials were.
const PHONEPE_DARK = `Paid to
SL Sri Lakshmi Medicals  ₹1,249.50
Q482917365@ybl
Banking Name : SRI LAKSHMI MEDICALS
BE Transfer Details
Transaction ID
T2611111915309876543210
Debited from
ft XXXXXX1234  ₹1,249.50
UTR: 431277001122
&  [¢]  2
2
Send Again  View History Split Expense  Share Receipt
? Contact PhonePe Support
Powered by UPI | YES BANK`;

const PHONEPE_RECEIVED = `Received from
Meera Nair
M  ¥2,000
meeranair@ibl
Banking Name : MEERA NAIR
BE Transfer Details
Transaction ID
T2611091620301112223334
Credited to
ft XXXXXX1234  ₹2,000
UTR: 431055667788
&  [¢]  2
2
Send Again  View History Split Expense  Share Receipt
? Contact PhonePe Support
Powered by UPI | YES BANK`;

const PHONEPE_12000 = `10:42  5G ull 87%
Transaction Successful
09:03 am on 10 Nov 2026
Paid to
Anil Kumar
©
£12,000
9876543210@ybl
Banking Name : ANIL KUMAR
E Transfer Details
Transaction ID
T2611100903305550001111  COPY
Debited from
iB XXXXXX1234  ¥12,000
UTR: 431165432109 COPY
2
4  [¢]  i)
2
Send Again  View History Split Expense  Share Receipt
? Contact PhonePe Support
Powered by UPI | YES BANK`;

const PAYTM_DARK = `10:42  5G lll 87%
paytm
Paid Successfully
₹1,249.50
Rupees One Thousand Two Hundred Forty
Nine and Fifty Paise Only
To: Sri Lakshmi Medicals
SL
UPI ID: srilakshmi.med@paytm
From: Priya Sharma
®
HDFC Bank - 1234
UPI Ref No: 431277001122 Copy
11 Nov 2026, 07:15 PM
2
2
Share  Check Balance  Pay Again
You won 25 Paytm cashback points!
Powered by UPI - Paytm Payments Bank`;

const PAYTM_RECEIVED = `10:42  5G lll 87%
paytm
Money Received
₹750
Rupees Seven Hundred Fifty Only
From: Meera Nair
MN
UPI ID: meeranair@paytm
To: Priya Sharma
®
HDFC Bank - 1234
UPI Ref No: 431055667799 Copy
9 Nov 2026, 04:20 PM
2
2
Share  Check Balance  Pay Again
You won 25 Paytm cashback points!
Powered by UPI - Paytm Payments Bank`;

const PAYTM_12000 = `10:42  5G 87%
paytm
Paid Successfully
₹12,000
Rupees Twelve Thousand Only
To: Anil Kumar
®
UPI ID: 9876543210@ptsbi
From: Priya Sharma
®
HDFC Bank - 1234
UPI Ref No: 431165432109 Copy
10 Nov 2026, 09:03 AM
N
€]  2
2
Share  Pay Again
Check Balance
#3 You won 25 Paytm cashback points!
Powered by UPI - Paytm Payments Bank`;

const BANK = `10:42  5G ull 87%
< UPI Payment
Payment Successful
Your transaction has been processed
Amount  ¥ 5,000.00
Paid to  City Electricity Board
Payee VPA  cityelectricity@sbi
Debited from  Savings A/c XX1234
Reference No.  430844556677
Date & Time  07 Nov 2026 18:05:22
Remarks  Bill Oct
| EE.
Share`;

/** What the capture pipeline will make of a screen: the message goes through the real parser. */
const via = (ocr: string) => {
  const msg = receiptToMessage(ocr);
  return msg ? parseAlert(msg, 'INR') : null;
};

describe('receiptToMessage: each layout, as read on the device', () => {
  it.each([
    ['Google Pay, "To …" above the amount', GPAY_DARK, 250_00, 'debit', 'Ramesh Stores', '431298765432', '12-11-2026'],
    ['Google Pay, money received ("From …")', GPAY_RECEIVED, 3_500_00, 'credit', 'Meera Nair', '431055667788', '09-11-2026'],
    ['Google Pay, older "Paid to" layout', GPAY_OLD, 480_00, 'debit', 'Hotel Saravana Bhavan', '430911223344', '08-11-2026'],
    ['PhonePe', PHONEPE_LIGHT, 250_00, 'debit', 'Ramesh Stores', '431298765432', '12-11-2026'],
    ['PhonePe, header unread, initials in front of the name', PHONEPE_DARK, 1_249_50, 'debit', 'Sri Lakshmi Medicals', '431277001122', undefined],
    ['PhonePe, received', PHONEPE_RECEIVED, 2_000_00, 'credit', 'Meera Nair', '431055667788', undefined],
    ['PhonePe, rupee sign read as £ and ¥', PHONEPE_12000, 12_000_00, 'debit', 'Anil Kumar', '431165432109', '10-11-2026'],
    ['Paytm, amount in words over two rows', PAYTM_DARK, 1_249_50, 'debit', 'Sri Lakshmi Medicals', '431277001122', '11-11-2026'],
    ['Paytm, money received', PAYTM_RECEIVED, 750_00, 'credit', 'Meera Nair', '431055667799', '09-11-2026'],
    ['Paytm', PAYTM_12000, 12_000_00, 'debit', 'Anil Kumar', '431165432109', '10-11-2026'],
    ['Bank app, label and value rows', BANK, 5_000_00, 'debit', 'City Electricity Board', '430844556677', '07-11-2026'],
  ])('%s', (_name, ocr, amount, direction, merchant, ref, date) => {
    const r = via(ocr)!;
    expect(r).toBeTruthy();
    expect([r.amount, r.direction, r.merchant, r.refNo, r.date]).toEqual([amount, direction, merchant, ref, date]);
    expect(r.currency).toBe('INR');
    // A named payee and a clear amount: confident enough to post without review.
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('writes one plain sentence', () => {
    expect(receiptToMessage(GPAY_DARK)).toBe('Paid ₹250.00 to Ramesh Stores. UPI Ref 431298765432 on 12-11-2026');
    expect(receiptToMessage(GPAY_RECEIVED)).toBe('Received ₹3500.00 from Meera Nair. UPI Ref 431055667788 on 09-11-2026');
    expect(receiptToMessage(PHONEPE_DARK)).toBe('Paid ₹1249.50 to Sri Lakshmi Medicals. UPI Ref 431277001122');
  });

  it('is sure of an amount that carries a rupee mark, and says so', () => {
    for (const ocr of [GPAY_DARK, GPAY_RECEIVED, PHONEPE_LIGHT, PHONEPE_DARK, PAYTM_DARK, PAYTM_12000, BANK]) expect(readReceipt(ocr)!.unsure).toBe(false);
  });
});

describe('receiptToMessage: screens that are not a completed payment', () => {
  it.each([
    ['Google Pay, failed', GPAY_DARK.replace('+) Completed', '1  Failed')],
    ['Paytm, pending', PAYTM_12000.replace('Paid Successfully', 'Payment Pending')],
    ['PhonePe, failed', PHONEPE_LIGHT.replace('Transaction Successful', 'Transaction Failed')],
    ['declined by the bank', BANK.replace('Payment Successful', 'Payment declined')],
    ['processing', GPAY_DARK.replace('+) Completed', 'Processing')],
    ['a request, not a payment', GPAY_DARK.replace('+) Completed', 'Payment request')],
  ])('%s → null', (_name, ocr) => {
    expect(receiptToMessage(ocr)).toBeNull();
  });

  it('is not put off by "failed" in the small print of a good receipt', () => {
    const ocr = `${PHONEPE_LIGHT}\nIf the payment failed but money was debited, it is refunded in 3 to 5 working days`;
    expect(via(ocr)!.amount).toBe(250_00);
  });

  it.each([
    ['nothing at all', ''],
    ['a photo with no text', '~\n|  .\n'],
    ['a chat screenshot', 'Meera\nAre we still meeting at 5?\nYes, see you at the cafe\n10:42'],
    ['only identifiers and dates', 'UPI transaction ID\n431298765432\n12 Nov 2026, 10:42 am\nHDFC Bank 1234'],
    ['a wallet balance screen', 'Paytm Wallet\nBalance ₹1,520.00\nAdd money'],
    ['an offer', 'You won 25 Paytm cashback points!\nCashback ₹25'],
  ])('%s → null', (_name, ocr) => {
    expect(receiptToMessage(ocr)).toBeNull();
  });
});

describe('receiptToMessage: OCR quirks', () => {
  it.each([
    ['%', '%250'], ['F', 'F250'], ['z', 'z250'], ['R', 'R250'], ['X', 'X250'], ['¥', '¥250'], ['£', '£250'], ['#', '#250'],
    ['% and a space', '% 250'], ['Rs.', 'Rs.250'], ['Rs and a space', 'Rs 250'], ['INR', 'INR 250.00'], ['a trailing /-', '₹250/-'],
  ])('rupee sign read as %s', (_name, amountRow) => {
    for (const ocr of [GPAY_DARK, PAYTM_12000.replace('₹12,000', '₹250').replace('Rupees Twelve Thousand Only\n', '')]) {
      const r = via(ocr.replace('₹250', amountRow))!;
      expect([r.amount, r.direction]).toEqual([250_00, 'debit']);
      expect(r.merchant).toBeTruthy();
    }
  });

  it('rupee sign missing: the bare number on its own row near "To …" is the amount, flagged as unsure', () => {
    const read = readReceipt(GPAY_DARK.replace('₹250', '250'))!;
    expect([read.amount, read.payee, read.unsure]).toEqual(['250.00', 'Ramesh Stores', true]);
    expect(via(GPAY_RECEIVED.replace('₹3,500', '3,500'))!.amount).toBe(3_500_00);
    expect(via(PAYTM_12000.replace('₹12,000', '12,000'))!.amount).toBe(12_000_00);
  });

  it('rupee sign missing on a PhonePe row: the number that closes the payee row', () => {
    const ocr = PHONEPE_12000.replace('Anil Kumar\n©\n£12,000', 'Anil Kumar 12,000').replace('¥12,000', '12,000');
    const r = via(ocr)!;
    expect([r.amount, r.merchant]).toEqual([12_000_00, 'Anil Kumar']);
  });

  it('rupee sign read as a digit: the amount in words wins (Paytm)', () => {
    // Exactly what Tesseract returned for "₹1,249.50" before the sign was restored from the pixels.
    expect(via(PAYTM_DARK.replace('₹1,249.50', '31,249.50 ©'))!.amount).toBe(1_249_50);
    expect(via(PAYTM_12000.replace('₹12,000', '312,000 (/]'))!.amount).toBe(12_000_00);
    expect(via(PAYTM_RECEIVED.replace('₹750', '2750'))!.amount).toBe(750_00);
  });

  it('rupee sign read as a digit: the second, clean copy of the amount wins (PhonePe)', () => {
    const ocr = PHONEPE_LIGHT.replace('Ramesh Stores\n₹250', 'Ramesh Stores\n2250').replace('XXXXXX1234  ₹250', 'XXXXXX1234  %250');
    expect(via(ocr)!.amount).toBe(250_00);
    const big = PHONEPE_DARK.replace('Medicals  ₹1,249.50', 'Medicals 21,249.50');
    expect(via(big)!.amount).toBe(1_249_50);
  });

  it('rupee sign read as a digit: four digits with no separator can’t be how an app prints an amount', () => {
    for (const row of ['3250', '2250', '7250']) {
      const read = readReceipt(GPAY_DARK.replace('₹250', row))!;
      expect([read.amount, read.unsure]).toEqual(['250.00', true]);
    }
    expect(via(GPAY_OLD.replace('₹480', '3480'))!.amount).toBe(480_00);
  });

  it('leaves a properly separated amount alone, whatever it starts with', () => {
    expect(via(GPAY_DARK.replace('₹250', '₹3,250'))!.amount).toBe(3_250_00);
    expect(via(GPAY_DARK.replace('₹250', '3,250'))!.amount).toBe(3_250_00);
    expect(via(GPAY_DARK.replace('₹250', '₹2,35,000'))!.amount).toBe(2_35_000_00);
    expect(via(BANK.replace('¥ 5,000.00', '3250.00'))!.amount).toBe(3_250_00);
    expect(via(GPAY_DARK.replace('₹250', '₹2050'))!.amount).toBe(2_050_00);
  });

  it('"O" for zero and "l" for one inside the amount', () => {
    expect(via(GPAY_DARK.replace('₹250', '₹25O'))!.amount).toBe(250_00);
    expect(via(GPAY_DARK.replace('₹250', '%1,OOO'))!.amount).toBe(1_000_00);
    expect(via(BANK.replace('¥ 5,000.00', '¥ 5,OOO.0O'))!.amount).toBe(5_000_00);
    expect(via(GPAY_DARK.replace('₹250', '₹1l,500'))!.amount).toBe(11_500_00);
    // …but never in a word that merely follows a number.
    expect(via(PAYTM_RECEIVED)!.amount).toBe(750_00);
  });

  it('the sign and the amount on separate rows', () => {
    expect(via(GPAY_DARK.replace('₹250', '₹\n250'))!.amount).toBe(250_00);
    expect(via(GPAY_DARK.replace('₹250', 'Rs\n1,249.50'))!.amount).toBe(1_249_50);
  });

  it('stray characters around the amount and the name', () => {
    const r = via(GPAY_DARK.replace('₹250', '| ₹250 .').replace('To Ramesh Stores', 'To Ramesh Stores |'))!;
    expect([r.amount, r.merchant]).toEqual([250_00, 'Ramesh Stores']);
  });

  it('never takes the clock, the battery, an account number, a phone number or a reference for the amount', () => {
    const noAmount = GPAY_DARK.replace('₹250\n', '');
    expect(receiptToMessage(noAmount)).toBeNull();
    expect(receiptToMessage(PHONEPE_12000.replace('£12,000\n', '').replace('  ¥12,000', ''))).toBeNull();
    expect(receiptToMessage(PAYTM_12000.replace('₹12,000\nRupees Twelve Thousand Only\n', ''))).toBeNull();
  });

  it('junk digits from icons never beat the real amount, and are never an amount themselves', () => {
    expect(via(`${PHONEPE_LIGHT}\n© 2\n% 4`)!.amount).toBe(250_00);
    expect(receiptToMessage('Paid to\nRamesh Stores\n© 2\n2\n4')).toBeNull();
  });

  it('a number in the payee’s name is not the amount', () => {
    const r = via(GPAY_OLD.replace('Paid to Hotel Saravana Bhavan', 'Paid to Store 24 Seven'))!;
    expect([r.amount, r.merchant]).toEqual([480_00, 'Store 24 Seven']);
  });

  it('keeps a payment with no readable payee, at lower confidence so it is reviewed', () => {
    const r = via('₹250\nCompleted\n12 Nov 2026, 10:42 am\nUPI transaction ID\n431298765432')!;
    expect([r.amount, r.direction, r.merchant, r.refNo]).toEqual([250_00, 'debit', undefined, '431298765432']);
    expect(r.confidence).toBeLessThan(0.9);
  });

  it('drops a reference that lost a digit rather than passing on a wrong one', () => {
    const read = readReceipt(PHONEPE_DARK.replace('UTR: 431277001122', 'UTR: 43127700122'))!;
    expect(read.refNo).toBeUndefined();
    expect(read.amount).toBe('1249.50');
  });

  it('reads dates in the forms receipts use', () => {
    const d = (row: string) => readReceipt(GPAY_DARK.replace('12 Nov 2026, 10:42 am', row))!.date;
    expect(d('12 November 2026 at 10:42')).toBe('12-11-2026');
    expect(d('Nov 12, 2026 10:42 AM')).toBe('12-11-2026');
    expect(d('12/11/2026 10:42')).toBe('12-11-2026');
    expect(d('12-Nov-26')).toBe('12-11-2026');
    expect(d('12 Nov, 10:42 am')).toBeUndefined();
  });
});

describe('wordsToPaise', () => {
  it.each([
    ['Rupees Two Hundred Fifty Only', 250_00],
    ['Rupees One Thousand Two Hundred Forty Nine and Fifty Paise Only', 1_249_50],
    ['Rupees Twelve Thousand Only', 12_000_00],
    ['Rupees Two Lakh Thirty-Five Thousand Only', 2_35_000_00],
    ['Rupees One Hundred and Five Only', 105_00],
    ['INR Ninety Nine Only', 99_00],
  ])('%s', (text, paise) => {
    expect(wordsToPaise(text)).toBe(paise);
  });

  it('gives up on a word it does not know', () => {
    expect(wordsToPaise('Rupees Two Hundrcd Fifty Only')).toBeNull();
    expect(wordsToPaise('Two Hundred Fifty')).toBeNull();
  });
});
