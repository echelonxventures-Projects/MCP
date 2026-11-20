#!/usr/bin/env python3
"""
E-commerce Catalog MCP Server
Product search, cart management, checkout, and recommendations
"""

import asyncio
import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from mcp.server import McpServer, tool, resource, prompt
from pydantic import BaseModel, Field


# ============================================
# MODELS
# ============================================

@dataclass
class Product:
    id: str
    name: str
    description: str
    price: Decimal
    currency: str = "USD"
    category: str = ""
    tags: List[str] = field(default_factory=list)
    images: List[str] = field(default_factory=list)
    inventory: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class CartItem:
    product_id: str
    quantity: int
    unit_price: Decimal
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Cart:
    id: str
    user_id: str
    items: List[CartItem] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    @property
    def subtotal(self) -> Decimal:
        return sum(item.unit_price * item.quantity for item in self.items)

    @property
    def total_items(self) -> int:
        return sum(item.quantity for item in self.items)


@dataclass
class Order:
    id: str
    user_id: str
    cart_id: str
    items: List[CartItem]
    subtotal: Decimal
    tax: Decimal
    shipping: Decimal
    total: Decimal
    status: str = "pending"
    shipping_address: Dict[str, Any] = field(default_factory=dict)
    billing_address: Dict[str, Any] = field(default_factory=dict)
    payment_method: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


# ============================================
# IN-MEMORY STORES
# ============================================

products: Dict[str, Product] = {}
carts: Dict[str, Cart] = {}
orders: Dict[str, Order] = {}


def initialize_sample_data():
    """Initialize sample e-commerce data."""
    sample_products = [
        Product(
            id="prod-001",
            name="Wireless Headphones Pro",
            description="Premium noise-cancelling wireless headphones with 30hr battery",
            price=Decimal("299.99"),
            category="electronics",
            tags=["audio", "wireless", "noise-cancelling"],
            images=["https://example.com/headphones.jpg"],
            inventory=100,
            metadata={"brand": "AudioTech", "warranty_months": 24},
        ),
        Product(
            id="prod-002",
            name="Smart Watch Series 5",
            description="Health monitoring smartwatch with GPS and cellular",
            price=Decimal("399.99"),
            category="electronics",
            tags=["wearable", "health", "gps"],
            images=["https://example.com/watch.jpg"],
            inventory=50,
            metadata={"brand": "TechCorp", "water_resistant": True},
        ),
        Product(
            id="prod-003",
            name="Organic Cotton T-Shirt",
            description="Sustainable organic cotton t-shirt in multiple colors",
            price=Decimal("29.99"),
            category="apparel",
            tags=["organic", "sustainable", "cotton"],
            images=["https://example.com/tshirt.jpg"],
            inventory=500,
            metadata={"sizes": ["S", "M", "L", "XL"], "colors": ["white", "black", "navy"]},
        ),
        Product(
            id="prod-004",
            name="Stainless Steel Water Bottle",
            description="Insulated 32oz water bottle, keeps cold 24hrs/hot 12hrs",
            price=Decimal("34.99"),
            category="home",
            tags=["insulated", "eco-friendly", "bpa-free"],
            images=["https://example.com/bottle.jpg"],
            inventory=200,
            metadata={"capacity_oz": 32, "material": "stainless_steel"},
        ),
    ]

    for product in sample_products:
        products[product.id] = product


initialize_sample_data()


# ============================================
# MCP SERVER
# ============================================

server = McpServer(
    name="ecommerce-catalog",
    version="1.0.0",
    capabilities={
        "tools": {"listChanged": True},
        "resources": {"subscribe": True, "listChanged": True},
        "prompts": {"listChanged": True},
        "logging": {},
    },
)


# ============================================
# TOOLS
# ============================================

@server.tool("search-products", "Search product catalog")
async def search_products(
    query: str = "",
    category: Optional[str] = None,
    tags: Optional[List[str]] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    in_stock_only: bool = False,
    limit: int = 20,
    offset: int = 0,
) -> Dict[str, Any]:
    """Search products with filters."""
    results = list(products.values())

    if query:
        query_lower = query.lower()
        results = [
            p for p in results
            if query_lower in p.name.lower() or query_lower in p.description.lower()
        ]

    if category:
        results = [p for p in results if p.category == category]

    if tags:
        results = [p for p in results if any(tag in p.tags for tag in tags)]

    if min_price is not None:
        results = [p for p in results if p.price >= Decimal(str(min_price))]

    if max_price is not None:
        results = [p for p in results if p.price <= Decimal(str(max_price))]

    if in_stock_only:
        results = [p for p in results if p.inventory > 0]

    total = len(results)
    results = results[offset:offset + limit]

    return {
        "products": [
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "price": str(p.price),
                "currency": p.currency,
                "category": p.category,
                "tags": p.tags,
                "images": p.images,
                "inventory": p.inventory,
                "metadata": p.metadata,
            }
            for p in results
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@server.tool("get-product", "Get product details")
async def get_product(product_id: str) -> Dict[str, Any]:
    """Get detailed product information."""
    product = products.get(product_id)
    if not product:
        return {"error": "Product not found", "product_id": product_id}

    return {
        "id": product.id,
        "name": product.name,
        "description": product.description,
        "price": str(product.price),
        "currency": product.currency,
        "category": product.category,
        "tags": product.tags,
        "images": product.images,
        "inventory": product.inventory,
        "metadata": product.metadata,
        "created_at": product.created_at,
        "updated_at": product.updated_at,
    }


@server.tool("get-categories", "Get all product categories")
async def get_categories() -> Dict[str, Any]:
    """Get all unique product categories."""
    categories = sorted(set(p.category for p in products.values() if p.category))
    return {"categories": categories}


@server.tool("get-tags", "Get all product tags")
async def get_tags() -> Dict[str, Any]:
    """Get all unique product tags."""
    tags = sorted(set(tag for p in products.values() for tag in p.tags))
    return {"tags": tags}


@server.tool("create-cart", "Create shopping cart")
async def create_cart(user_id: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Create a new shopping cart for a user."""
    cart_id = f"cart-{uuid.uuid4().hex[:12]}"
    cart = Cart(id=cart_id, user_id=user_id, metadata=metadata or {})
    carts[cart_id] = cart
    return {"cart_id": cart_id, "user_id": user_id, "items": [], "subtotal": "0.00"}


@server.tool("get-cart", "Get cart contents")
async def get_cart(cart_id: str) -> Dict[str, Any]:
    """Get cart contents and totals."""
    cart = carts.get(cart_id)
    if not cart:
        return {"error": "Cart not found", "cart_id": cart_id}

    items = []
    for item in cart.items:
        product = products.get(item.product_id)
        items.append({
            "product_id": item.product_id,
            "product_name": product.name if product else "Unknown",
            "quantity": item.quantity,
            "unit_price": str(item.unit_price),
            "line_total": str(item.unit_price * item.quantity),
            "metadata": item.metadata,
        })

    return {
        "cart_id": cart.id,
        "user_id": cart.user_id,
        "items": items,
        "subtotal": str(cart.subtotal),
        "total_items": cart.total_items,
        "metadata": cart.metadata,
    }


@server.tool("add-to-cart", "Add item to cart")
async def add_to_cart(
    cart_id: str,
    product_id: str,
    quantity: int = 1,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Add product to cart."""
    cart = carts.get(cart_id)
    if not cart:
        return {"error": "Cart not found", "cart_id": cart_id}

    product = products.get(product_id)
    if not product:
        return {"error": "Product not found", "product_id": product_id}

    if product.inventory < quantity:
        return {"error": "Insufficient inventory", "available": product.inventory}

    # Check if item already in cart
    for item in cart.items:
        if item.product_id == product_id:
            item.quantity += quantity
            item.metadata.update(metadata or {})
            cart.updated_at = datetime.utcnow().isoformat()
            return {"success": True, "cart": await get_cart(cart_id)}

    # Add new item
    cart.items.append(CartItem(
        product_id=product_id,
        quantity=quantity,
        unit_price=product.price,
        metadata=metadata or {},
    ))
    cart.updated_at = datetime.utcnow().isoformat()

    return {"success": True, "cart": await get_cart(cart_id)}


@server.tool("update-cart-item", "Update cart item quantity")
async def update_cart_item(
    cart_id: str,
    product_id: str,
    quantity: int,
) -> Dict[str, Any]:
    """Update quantity of item in cart."""
    cart = carts.get(cart_id)
    if not cart:
        return {"error": "Cart not found", "cart_id": cart_id}

    product = products.get(product_id)
    if not product:
        return {"error": "Product not found", "product_id": product_id}

    if quantity <= 0:
        cart.items = [item for item in cart.items if item.product_id != product_id]
    elif product.inventory < quantity:
        return {"error": "Insufficient inventory", "available": product.inventory}
    else:
        for item in cart.items:
            if item.product_id == product_id:
                item.quantity = quantity
                break

    cart.updated_at = datetime.utcnow().isoformat()
    return {"success": True, "cart": await get_cart(cart_id)}


@server.tool("remove-from-cart", "Remove item from cart")
async def remove_from_cart(cart_id: str, product_id: str) -> Dict[str, Any]:
    """Remove item from cart."""
    cart = carts.get(cart_id)
    if not cart:
        return {"error": "Cart not found", "cart_id": cart_id}

    cart.items = [item for item in cart.items if item.product_id != product_id]
    cart.updated_at = datetime.utcnow().isoformat()
    return {"success": True, "cart": await get_cart(cart_id)}


@server.tool("clear-cart", "Clear all items from cart")
async def clear_cart(cart_id: str) -> Dict[str, Any]:
    """Clear all items from cart."""
    cart = carts.get(cart_id)
    if not cart:
        return {"error": "Cart not found", "cart_id": cart_id}

    cart.items = []
    cart.updated_at = datetime.utcnow().isoformat()
    return {"success": True, "cart": await get_cart(cart_id)}


@server.tool("checkout", "Process checkout")
async def checkout(
    cart_id: str,
    shipping_address: Dict[str, Any],
    billing_address: Dict[str, Any],
    payment_method: str,
    shipping_cost: float = 9.99,
    tax_rate: float = 0.08,
) -> Dict[str, Any]:
    """Process checkout and create order."""
    cart = carts.get(cart_id)
    if not cart:
        return {"error": "Cart not found", "cart_id": cart_id}

    if not cart.items:
        return {"error": "Cart is empty"}

    # Calculate totals
    subtotal = cart.subtotal
    tax = subtotal * Decimal(str(tax_rate))
    shipping = Decimal(str(shipping_cost))
    total = subtotal + tax + shipping

    # Create order
    order_id = f"order-{uuid.uuid4().hex[:12]}"
    order = Order(
        id=order_id,
        user_id=cart.user_id,
        cart_id=cart_id,
        items=cart.items.copy(),
        subtotal=subtotal,
        tax=tax,
        shipping=shipping,
        total=total,
        shipping_address=shipping_address,
        billing_address=billing_address,
        payment_method=payment_method,
    )
    orders[order_id] = order

    # Clear cart
    cart.items = []
    cart.updated_at = datetime.utcnow().isoformat()

    return {
        "order_id": order_id,
        "status": order.status,
        "subtotal": str(subtotal),
        "tax": str(tax),
        "shipping": str(shipping),
        "total": str(total),
        "items_count": len(order.items),
    }


@server.tool("get-order", "Get order details")
async def get_order(order_id: str) -> Dict[str, Any]:
    """Get order details."""
    order = orders.get(order_id)
    if not order:
        return {"error": "Order not found", "order_id": order_id}

    items = []
    for item in order.items:
        product = products.get(item.product_id)
        items.append({
            "product_id": item.product_id,
            "product_name": product.name if product else "Unknown",
            "quantity": item.quantity,
            "unit_price": str(item.unit_price),
            "line_total": str(item.unit_price * item.quantity),
        })

    return {
        "id": order.id,
        "user_id": order.user_id,
        "cart_id": order.cart_id,
        "items": items,
        "subtotal": str(order.subtotal),
        "tax": str(order.tax),
        "shipping": str(order.shipping),
        "total": str(order.total),
        "status": order.status,
        "shipping_address": order.shipping_address,
        "billing_address": order.billing_address,
        "payment_method": order.payment_method,
        "created_at": order.created_at,
    }


@server.tool("get-user-orders", "Get user's order history")
async def get_user_orders(user_id: str, limit: int = 20) -> Dict[str, Any]:
    """Get order history for a user."""
    user_orders = [o for o in orders.values() if o.user_id == user_id]
    user_orders.sort(key=lambda o: o.created_at, reverse=True)
    user_orders = user_orders[:limit]

    return {
        "orders": [
            {
                "id": o.id,
                "status": o.status,
                "total": str(o.total),
                "items_count": len(o.items),
                "created_at": o.created_at,
            }
            for o in user_orders
        ],
        "total": len(user_orders),
    }


@server.tool("get-recommendations", "Get product recommendations")
async def get_recommendations(
    user_id: Optional[str] = None,
    product_id: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 5,
) -> Dict[str, Any]:
    """Get product recommendations."""
    recommendations = []

    if product_id:
        # Recommend products in same category
        product = products.get(product_id)
        if product:
            recommendations = [
                p for p in products.values()
                if p.category == product.category and p.id != product_id
            ][:limit]

    elif category:
        recommendations = [
            p for p in products.values()
            if p.category == category
        ][:limit]

    elif user_id:
        # Simple recommendation based on user's order history
        user_orders = [o for o in orders.values() if o.user_id == user_id]
        purchased_categories = set()
        for order in user_orders:
            for item in order.items:
                product = products.get(item.product_id)
                if product:
                    purchased_categories.add(product.category)

        recommendations = [
            p for p in products.values()
            if p.category in purchased_categories
        ][:limit]

    else:
        # Return popular/bestselling (mock)
        recommendations = list(products.values())[:limit]

    return {
        "recommendations": [
            {
                "id": p.id,
                "name": p.name,
                "price": str(p.price),
                "category": p.category,
                "images": p.images[:1],
            }
            for p in recommendations
        ]
    }


# ============================================
# RESOURCES
# ============================================

@server.resource("product://{product_id}", "Product details")
async def product_resource(product_id: str) -> Dict[str, Any]:
    """Product resource."""
    product = products.get(product_id)
    if not product:
        raise ValueError(f"Product not found: {product_id}")

    return {
        "id": product.id,
        "name": product.name,
        "description": product.description,
        "price": str(product.price),
        "currency": product.currency,
        "category": product.category,
        "tags": product.tags,
        "images": product.images,
        "inventory": product.inventory,
        "metadata": product.metadata,
    }


@server.resource("cart://{cart_id}", "Shopping cart")
async def cart_resource(cart_id: str) -> Dict[str, Any]:
    """Shopping cart resource."""
    cart = carts.get(cart_id)
    if not cart:
        raise ValueError(f"Cart not found: {cart_id}")

    items = []
    for item in cart.items:
        product = products.get(item.product_id)
        items.append({
            "product_id": item.product_id,
            "product_name": product.name if product else "Unknown",
            "quantity": item.quantity,
            "unit_price": str(item.unit_price),
            "line_total": str(item.unit_price * item.quantity),
        })

    return {
        "cart_id": cart.id,
        "user_id": cart.user_id,
        "items": items,
        "subtotal": str(cart.subtotal),
        "total_items": cart.total_items,
    }


@server.resource("order://{order_id}", "Order details")
async def order_resource(order_id: str) -> Dict[str, Any]:
    """Order resource."""
    order = orders.get(order_id)
    if not order:
        raise ValueError(f"Order not found: {order_id}")

    items = []
    for item in order.items:
        product = products.get(item.product_id)
        items.append({
            "product_id": item.product_id,
            "product_name": product.name if product else "Unknown",
            "quantity": item.quantity,
            "unit_price": str(item.unit_price),
            "line_total": str(item.unit_price * item.quantity),
        })

    return {
        "id": order.id,
        "user_id": order.user_id,
        "items": items,
        "subtotal": str(order.subtotal),
        "tax": str(order.tax),
        "shipping": str(order.shipping),
        "total": str(order.total),
        "status": order.status,
    }


@server.resource("category://{category}", "Products by category")
async def category_resource(category: str) -> Dict[str, Any]:
    """Products in a category."""
    category_products = [p for p in products.values() if p.category == category]
    return {
        "category": category,
        "products": [
            {
                "id": p.id,
                "name": p.name,
                "price": str(p.price),
                "inventory": p.inventory,
            }
            for p in category_products
        ],
        "count": len(category_products),
    }


# ============================================
# PROMPTS
# ============================================

@server.prompt("product-recommendation", "Generate personalized product recommendations")
async def product_recommendation_prompt(
    user_id: str,
    context: Optional[str] = None,
    budget: Optional[float] = None,
) -> Dict[str, Any]:
    """Generate product recommendation prompt."""
    user_orders = [o for o in orders.values() if o.user_id == user_id]
    purchased = []
    for order in user_orders:
        for item in order.items:
            product = products.get(item.product_id)
            if product:
                purchased.append(product.name)

    prompt = f"""You are a personal shopping assistant. Recommend products for user {user_id}.

User's purchase history: {', '.join(purchased) if purchased else 'No previous purchases'}
Context: {context or 'General shopping'}
Budget: ${budget or 'Not specified'}

Provide 3-5 personalized recommendations with reasoning."""

    return {
        "messages": [
            {"role": "system", "content": "You are a knowledgeable personal shopping assistant. Provide personalized, helpful recommendations."},
            {"role": "user", "content": prompt},
        ]
    }


@server.prompt("cart-abandonment-recovery", "Generate cart recovery message")
async def cart_abandonment_prompt(cart_id: str, user_name: str = "Customer") -> Dict[str, Any]:
    """Generate cart abandonment recovery message."""
    cart = carts.get(cart_id)
    if not cart or not cart.items:
        return {"messages": [{"role": "user", "content": "Cart is empty or not found."}]}

    items = []
    for item in cart.items:
        product = products.get(item.product_id)
        if product:
            items.append(f"- {product.name} (Qty: {item.quantity}) - ${item.unit_price * item.quantity}")

    prompt = f"""Write a friendly cart abandonment recovery email for {user_name}.

Cart contents:
{chr(10).join(items)}
Cart total: ${cart.subtotal}

Include: gentle reminder, product benefits, easy checkout link, optional incentive."""

    return {
        "messages": [
            {"role": "system", "content": "You are an e-commerce marketing specialist. Write compelling, non-pushy recovery messages."},
            {"role": "user", "content": prompt},
        ]
    }


@server.prompt("product-comparison", "Compare products")
async def product_comparison_prompt(product_ids: List[str]) -> Dict[str, Any]:
    """Generate product comparison prompt."""
    products_data = []
    for pid in product_ids:
        product = products.get(pid)
        if product:
            products_data.append(f"- {product.name}: ${product.price} - {product.description}")

    prompt = f"""Compare these products and help the customer choose:

{chr(10).join(products_data)}

Provide: feature comparison table, pros/cons for each, recommendation based on use cases."""

    return {
        "messages": [
            {"role": "system", "content": "You are a product expert. Provide clear, balanced comparisons."},
            {"role": "user", "content": prompt},
        ]
    }


# ============================================
# HEALTH CHECK
# ============================================

@server.tool("health", "Health check")
async def health() -> Dict[str, Any]:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "products": len(products),
        "carts": len(carts),
        "orders": len(orders),
        "categories": len(set(p.category for p in products.values())),
    }


# ============================================
# MAIN
# ============================================

async def main():
    transport = os.getenv("MCP_TRANSPORT", "websocket")
    port = int(os.getenv("MCP_PORT", "3000"))
    host = os.getenv("MCP_HOST", "0.0.0.0")

    print(f"Starting ecommerce-catalog on {transport}...", file=sys.stderr)

    if transport == "websocket":
        await server.start(transport="websocket", port=port, host=host)
    elif transport == "http-sse":
        await server.start(transport="http-sse", port=port, host=host)
    elif transport == "grpc":
        await server.start(transport="grpc", port=port, host=host)
    else:
        await server.start(transport="stdio")

    print("E-commerce catalog server started", file=sys.stderr)


if __name__ == "__main__":
    import sys
    asyncio.run(main())