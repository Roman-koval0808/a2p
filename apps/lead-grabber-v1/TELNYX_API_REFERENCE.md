# Telnyx API Quick Reference

## Authentication

All requests require your Telnyx API key in the Authorization header:

```bash
Authorization: Bearer YOUR_API_KEY
```

## 1. Create Billing Group

**Endpoint:** `POST https://api.telnyx.com/v2/billing_groups`

**Request:**

```bash
curl -X POST https://api.telnyx.com/v2/billing_groups \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corporation-cm5abc123"
  }'
```

**Response:**

```json
{
	"data": {
		"id": "f5586561-8ff0-4291-a0ac-84fe544797bd",
		"name": "Acme Corporation-cm5abc123",
		"created_at": "2026-02-02T16:13:27.000Z",
		"updated_at": "2026-02-02T16:13:27.000Z",
		"record_type": "billing_group"
	}
}
```

---

## 2. List Billing Groups

**Endpoint:** `GET https://api.telnyx.com/v2/billing_groups`

**Request:**

```bash
curl -X GET https://api.telnyx.com/v2/billing_groups \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Response:**

```json
{
	"data": [
		{
			"id": "f5586561-8ff0-4291-a0ac-84fe544797bd",
			"name": "Acme Corporation-cm5abc123",
			"created_at": "2026-02-02T16:13:27.000Z",
			"updated_at": "2026-02-02T16:13:27.000Z",
			"record_type": "billing_group"
		}
	]
}
```

---

## 3. Order Specific Phone Numbers

**Endpoint:** `POST https://api.telnyx.com/v2/number_orders`

**Request:**

```bash
curl -X POST https://api.telnyx.com/v2/number_orders \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_numbers": [
      {
        "phone_number": "+12025551234",
        "billing_group_id": "f5586561-8ff0-4291-a0ac-84fe544797bd"
      },
      {
        "phone_number": "+12025555678",
        "billing_group_id": "f5586561-8ff0-4291-a0ac-84fe544797bd"
      }
    ]
  }'
```

**Response:**

```json
{
	"data": {
		"id": "order_abc123",
		"status": "pending",
		"phone_numbers": [
			{
				"id": "pn_123",
				"phone_number": "+12025551234",
				"status": "pending"
			},
			{
				"id": "pn_456",
				"phone_number": "+12025555678",
				"status": "pending"
			}
		],
		"created_at": "2026-02-02T16:15:00.000Z",
		"updated_at": "2026-02-02T16:15:00.000Z"
	}
}
```

---

## 4. Bulk Order Phone Numbers (US/CA Only)

**Endpoint:** `POST https://api.telnyx.com/v2/inexplicit_number_orders`

**Request:**

```bash
curl -X POST https://api.telnyx.com/v2/inexplicit_number_orders \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "ordering_groups": [
      {
        "country_iso": "US",
        "phone_number_type": "local",
        "count_requested": 10,
        "area_code": "202",
        "billing_group_id": "f5586561-8ff0-4291-a0ac-84fe544797bd"
      }
    ]
  }'
```

**Response:**

```json
{
	"data": {
		"id": "bulk_order_xyz789",
		"status": "pending",
		"ordering_groups": [
			{
				"country_iso": "US",
				"phone_number_type": "local",
				"count_requested": 10,
				"count_fulfilled": 0,
				"area_code": "202",
				"billing_group_id": "f5586561-8ff0-4291-a0ac-84fe544797bd"
			}
		],
		"created_at": "2026-02-02T16:20:00.000Z",
		"updated_at": "2026-02-02T16:20:00.000Z"
	}
}
```

---

## 5. Get Order Status

**Endpoint:** `GET https://api.telnyx.com/v2/number_orders/{order_id}`

**Request:**

```bash
curl -X GET https://api.telnyx.com/v2/number_orders/order_abc123 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Response:**

```json
{
	"data": {
		"id": "order_abc123",
		"status": "success",
		"phone_numbers": [
			{
				"id": "pn_123",
				"phone_number": "+12025551234",
				"status": "success"
			}
		],
		"created_at": "2026-02-02T16:15:00.000Z",
		"updated_at": "2026-02-02T16:15:30.000Z"
	}
}
```

**Order Statuses:**

- `pending` - Order is being processed
- `success` - Order completed successfully
- `failed` - Order failed

---

## 6. List Phone Numbers in Billing Group

**Endpoint:** `GET https://api.telnyx.com/v2/phone_numbers?filter[billing_group_id]={billing_group_id}`

**Request:**

```bash
curl -X GET "https://api.telnyx.com/v2/phone_numbers?filter[billing_group_id]=f5586561-8ff0-4291-a0ac-84fe544797bd" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Response:**

```json
{
	"data": [
		{
			"id": "pn_123",
			"phone_number": "+12025551234",
			"status": "active",
			"billing_group_id": "f5586561-8ff0-4291-a0ac-84fe544797bd"
		},
		{
			"id": "pn_456",
			"phone_number": "+12025555678",
			"status": "active",
			"billing_group_id": "f5586561-8ff0-4291-a0ac-84fe544797bd"
		}
	]
}
```

---

## Phone Number Types

| Type        | Description         | Example      |
| ----------- | ------------------- | ------------ |
| `local`     | Local phone numbers | +12025551234 |
| `toll_free` | Toll-free numbers   | +18005551234 |
| `national`  | National numbers    | +12125551234 |
| `mobile`    | Mobile numbers      | +13105551234 |

---

## Common Parameters

### Bulk Order Options

- `country_iso`: Country code (e.g., "US", "CA")
- `phone_number_type`: Type of number (see table above)
- `count_requested`: Number of phone numbers to order (1-100)
- `area_code`: Preferred area code (optional)
- `state`: State abbreviation (optional, e.g., "CA", "NY")
- `billing_group_id`: **REQUIRED** - Billing group to associate numbers with

### Standard Order Options

- `phone_number`: E.164 formatted number (e.g., "+12025551234")
- `billing_group_id`: **REQUIRED** - Billing group to associate number with

---

## Error Handling

**Error Response Format:**

```json
{
	"errors": [
		{
			"code": "10015",
			"title": "Invalid phone number",
			"detail": "The phone number +1234 is not valid",
			"source": {
				"pointer": "/data/attributes/phone_number"
			}
		}
	]
}
```

**Common Error Codes:**

- `10015` - Invalid phone number format
- `10016` - Phone number not available
- `20001` - Authentication failed
- `20002` - Insufficient permissions
- `40001` - Billing group not found

---

## Best Practices

1. **Always create billing group first** before ordering numbers
2. **Use unique billing group names**: `company_name-company_id`
3. **Check order status** after placing bulk orders (they may take time to fulfill)
4. **Handle errors gracefully** - API may fail if numbers aren't available
5. **Use E.164 format** for all phone numbers: `+[country_code][number]`

---

## Resources

- [Telnyx API Documentation](https://developers.telnyx.com/docs/api/v2/overview)
- [Billing Groups API](https://developers.telnyx.com/docs/api/v2/billing/Billing-Groups)
- [Number Orders API](https://developers.telnyx.com/docs/api/v2/numbers/Number-Orders)
- [Mission Control Dashboard](https://portal.telnyx.com/)
