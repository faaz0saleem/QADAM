# Importing a brand's catalogue

§8.4. When a brand signs, they hand over a spreadsheet. This turns that into a
ten-minute job.

```bash
# always look first — this writes nothing
node scripts/import-catalogue.mjs --brand "Sample Threads" catalogue.csv

# then import
DATABASE_URL=... node scripts/import-catalogue.mjs --brand "Sample Threads" --apply catalogue.csv
```

## What the sheet needs

| Column | Required | Notes |
|---|---|---|
| `title` | yes | Also accepted: `name`, `product`, `product name` |
| `price` | yes | Also: `price_pkr`, `selling price`, `retail price`, `mrp` |
| `cost` | yes | Also: `cost_pkr`, `buying price`, `our price`, `wholesale` |
| `stock` | no | Defaults to 0. Also: `qty`, `quantity`, `available` |
| `images` | no | Separate with `\|`, `;` or newlines |
| `category` | no | Must already exist. `--category` sets a default |

Prices can arrive as `3200`, `3,200`, `PKR 3200`, `Rs. 3,200` or `3200/-`.
Anything else is rejected rather than guessed at — a wrong price in the
catalogue is worse than a failed import.

## Why it asks for cost

`cost_pkr` is the input to §0. Without a real buying price the discount ceiling
is a guess, and a guessed ceiling on a low-margin line is a loss on every unit.

The dry run prints what §0 allows on each row before anything is written:

```
  title                                 price     cost   margin  max disc  of price
  Lawn kurta, three piece               4,500    2,200    51.1%       450     10.0%
  Budget smartphone                    42,000   40,300     4.0%       340      0.8%
```

That last column is usually the most useful thing in a brand conversation. A
fat-margin clothing line discounts the full 10%; a thin-margin electronics line
discounts under 1%. Nobody should be surprised by that after the fact.

## It is all-or-nothing

Every row is validated before any row is written, and the write runs in one
transaction. A sheet with one bad price imports nothing, prints every problem
with its line number, and exits non-zero. Fix the sheet and run it again.

Re-importing is safe: a row whose title already exists for that brand is
updated, not duplicated.

## What this importer will not do

It does not fetch product data from anywhere. §8 is explicit — we do not lift
catalogues or photos from other retailers. Product images belong to the brand or
the photographer, competitor terms prohibit it, affiliate accounts get
terminated for it, and an order for something we do not stock is a chargeback
and a dead customer.

Everything imported here comes from the brand that signed with us.
