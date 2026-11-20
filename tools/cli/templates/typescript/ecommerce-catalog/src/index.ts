/**
 * E-commerce Catalog MCP Server
 * Product search, recommendations, inventory, and cart management
 */

import { McpServer, tool, resource, prompt } from "@mcp/server";
import { z } from "zod";

// Type definitions
interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  tags: string[];
  images: string[];
  inventory: number;
  rating: number;
  reviews: number;
}

interface CartItem {
  productId: string;
  quantity: number;
  price: number;
}

interface Cart {
  userId: string;
  items: CartItem[];
  total: number;
  currency: string;
  updatedAt: string;
}

// Mock data store (replace with real database)
const products: Map<string, Product> = new Map();
const carts: Map<string, Cart> = new Map();

// Initialize with sample data
function initializeSampleData() {
  const sampleProducts: Product[] = [
    {
      id: "prod-001",
      name: "Wireless Headphones Pro",
      description: "Premium noise-cancelling wireless headphones with 30hr battery",
      price: 299.99,
      currency: "USD",
      category: "electronics",
      tags: ["audio", "wireless", "noise-cancelling", "premium"],
      images: ["https://example.com/headphones.jpg"],
      inventory: 100,
      rating: 4.8,
      reviews: 2450,
    },
    {
      id: "prod-002",
      name: "Smart Watch Series 5",
      description: "Advanced health monitoring, GPS, and cellular connectivity",
      price: 399.99,
      currency: "USD",
      category: "electronics",
      tags: ["wearable", "health", "fitness", "smartwatch"],
      images: ["https://example.com/smartwatch.jpg"],
      inventory: 75,
      rating: 4.7,
      reviews: 1890,
    },
    {
      id: "prod-003",
      name: "Organic Cotton T-Shirt",
      description: "Sustainably sourced, comfortable everyday wear",
      price: 29.99,
      currency: "USD",
      category: "apparel",
      tags: ["clothing", "organic", "sustainable", "casual"],
      images: ["https://example.com/tshirt.jpg"],
      inventory: 500,
      rating: 4.5,
      reviews: 560,
    },
  ];

  for (const product of sampleProducts) {
    products.set(product.id, product);
  }
}

initializeSampleData();

// Create MCP server
const server = new McpServer({
  name: "ecommerce-catalog",
  version: "1.2.0",
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
    logging: {},
  },
});

// ============================================
// TOOLS
// ============================================

// Search products
server.tool(
  "search-products",
  "Search product catalog with filters",
  {
    query: z.string().optional().describe("Search query"),
    category: z.string().optional().describe("Filter by category"),
    tags: z.array(z.string()).optional().describe("Filter by tags"),
    minPrice: z.number().positive().optional().describe("Minimum price"),
    maxPrice: z.number().positive().optional().describe("Maximum price"),
    inStock: z.boolean().optional().describe("Only show in-stock items"),
    sortBy: z.enum(["relevance", "price-asc", "price-desc", "rating", "newest"]).optional().describe("Sort order"),
    limit: z.number().int().positive().max(100).optional().default(20).describe("Results limit"),
    offset: z.number().int().min(0).optional().default(0).describe("Pagination offset"),
  },
  async ({ query, category, tags, minPrice, maxPrice, inStock, sortBy = "relevance", limit = 20, offset = 0 }) => {
    let results = Array.from(products.values());

    // Apply filters
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    if (category) {
      results = results.filter(p => p.category === category);
    }
    if (tags && tags.length > 0) {
      results = results.filter(p => tags.some(t => p.tags.includes(t)));
    }
    if (minPrice !== undefined) {
      results = results.filter(p => p.price >= minPrice);
    }
    if (maxPrice !== undefined) {
      results = results.filter(p => p.price <= maxPrice);
    }
    if (inStock) {
      results = results.filter(p => p.inventory > 0);
    }

    // Sort
    switch (sortBy) {
      case "price-asc": results.sort((a, b) => a.price - b.price); break;
      case "price-desc": results.sort((a, b) => b.price - a.price); break;
      case "rating": results.sort((a, b) => b.rating - a.rating); break;
      case "newest": results.sort((a, b) => b.id.localeCompare(a.id)); break;
    }

    // Paginate
    const total = results.length;
    const paginated = results.slice(offset, offset + limit);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          products: paginated,
          pagination: { total, limit, offset, hasMore: offset + limit < total },
        }, null, 2),
      }],
    };
  }
);

// Get product details
server.tool(
  "get-product",
  "Get detailed product information",
  {
    productId: z.string().describe("Product ID"),
  },
  async ({ productId }) => {
    const product = products.get(productId);
    if (!product) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Product not found" }) }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(product, null, 2) }],
    };
  }
);

// Add to cart
server.tool(
  "add-to-cart",
  "Add product to user's cart",
  {
    userId: z.string().describe("User ID"),
    productId: z.string().describe("Product ID"),
    quantity: z.number().int().positive().default(1).describe("Quantity"),
  },
  async ({ userId, productId, quantity }) => {
    const product = products.get(productId);
    if (!product) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Product not found" }) }], isError: true };
    }
    if (product.inventory < quantity) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Insufficient inventory" }) }], isError: true };
    }

    let cart = carts.get(userId);
    if (!cart) {
      cart = { userId, items: [], total: 0, currency: "USD", updatedAt: new Date().toISOString() };
    }

    const existingItem = cart.items.find(i => i.productId === productId);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.items.push({ productId, quantity, price: product.price });
    }

    cart.total = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    cart.updatedAt = new Date().toISOString();
    carts.set(userId, cart);

    return { content: [{ type: "text", text: JSON.stringify(cart, null, 2) }] };
  }
);

// Get cart
server.tool(
  "get-cart",
  "Get user's shopping cart",
  {
    userId: z.string().describe("User ID"),
  },
  async ({ userId }) => {
    const cart = carts.get(userId) || { userId, items: [], total: 0, currency: "USD", updatedAt: new Date().toISOString() };
    return { content: [{ type: "text", text: JSON.stringify(cart, null, 2) }] };
  }
);

// Checkout
server.tool(
  "checkout",
  "Process checkout for user's cart",
  {
    userId: z.string().describe("User ID"),
    paymentMethodId: z.string().describe("Payment method ID"),
    shippingAddress: z.object({
      name: z.string(),
      line1: z.string(),
      line2: z.string().optional(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
      country: z.string(),
    }).describe("Shipping address"),
  },
  async ({ userId, paymentMethodId, shippingAddress }) => {
    const cart = carts.get(userId);
    if (!cart || cart.items.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Cart is empty" }) }], isError: true };
    }

    // Verify inventory
    for (const item of cart.items) {
      const product = products.get(item.productId);
      if (!product || product.inventory < item.quantity) {
        return { content: [{ type: "text", text: JSON.stringify({ error: `Insufficient inventory for ${item.productId}` }) }], isError: true };
      }
    }

    // Deduct inventory
    for (const item of cart.items) {
      const product = products.get(item.productId)!;
      product.inventory -= item.quantity;
    }

    const orderId = `order-${Date.now()}`;
    const order = {
      id: orderId,
      userId,
      items: cart.items,
      total: cart.total,
      currency: cart.currency,
      shippingAddress,
      paymentMethodId,
      status: "confirmed",
      createdAt: new Date().toISOString(),
    };

    // Clear cart
    carts.delete(userId);

    return { content: [{ type: "text", text: JSON.stringify(order, null, 2) }] };
  }
);

// Get recommendations
server.tool(
  "get-recommendations",
  "Get personalized product recommendations",
  {
    userId: z.string().describe("User ID"),
    context: z.string().optional().describe("Context for recommendations (e.g., 'gaming setup', 'work from home')"),
    limit: z.number().int().positive().max(20).optional().default(10).describe("Number of recommendations"),
  },
  async ({ userId, context, limit = 10 }) => {
    // Simple recommendation logic based on cart/purchase history
    const cart = carts.get(userId);
    const categories = cart?.items.map(i => products.get(i.productId)?.category).filter(Boolean) || [];
    const preferredCategories = [...new Set(categories)];

    let candidates = Array.from(products.values()).filter(p => p.inventory > 0);

    if (preferredCategories.length > 0) {
      candidates = candidates.filter(p => preferredCategories.includes(p.category));
    }

    // Sort by rating
    candidates.sort((a, b) => b.rating - a.rating);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          recommendations: candidates.slice(0, limit),
          context: context || "general",
        }, null, 2),
      }],
    };
  }
);

// ============================================
// RESOURCES
// ============================================

// Product catalog resource
server.resource(
  "catalog://products",
  "Full product catalog",
  async (uri) => {
    const allProducts = Array.from(products.values());
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ products: allProducts, total: allProducts.length }, null, 2),
      }],
    };
  }
);

// Single product resource
server.resource(
  "product://{productId}",
  "Individual product details",
  async (uri) => {
    const product = products.get(uri.params.productId);
    if (!product) {
      throw new Error(`Product not found: ${uri.params.productId}`);
    }
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(product, null, 2),
      }],
    };
  }
);

// Cart resource
server.resource(
  "cart://{userId}",
  "User's shopping cart",
  async (uri) => {
    const cart = carts.get(uri.params.userId) || { userId: uri.params.userId, items: [], total: 0, currency: "USD", updatedAt: new Date().toISOString() };
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(cart, null, 2),
      }],
    };
  }
);

// Categories resource
server.resource(
  "catalog://categories",
  "Product categories",
  async (uri) => {
    const categories = [...new Set(Array.from(products.values()).map(p => p.category))];
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ categories }, null, 2),
      }],
    };
  }
);

// ============================================
// PROMPTS
// ============================================

// Product recommendation prompt
server.prompt(
  "product-recommendation",
  "Generate personalized product recommendations for a user",
  {
    userId: z.string().describe("User ID"),
    context: z.string().optional().describe("Shopping context (e.g., 'gift for mom', 'home office setup')"),
    budget: z.number().positive().optional().describe("Budget range"),
  },
  ({ userId, context, budget }) => {
    const cart = carts.get(userId);
    const cartItems = cart?.items.map(i => {
      const p = products.get(i.productId);
      return p ? `${p.name} (${i.quantity}x $${p.price})` : null;
    }).filter(Boolean).join(", ") || "empty";

    return {
      messages: [
        {
          role: "system",
          content: "You are a knowledgeable shopping assistant. Provide personalized, helpful product recommendations based on the user's context and cart.",
        },
        {
          role: "user",
          content: `User ID: ${userId}\nCurrent cart: ${cartItems}\nContext: ${context || "general browsing"}${budget ? `\nBudget: $${budget}` : ""}\n\nPlease recommend products that would complement their current cart or match their shopping context.`,
        },
      ],
    };
  }
);

// Cart summary prompt
server.prompt(
  "cart-summary",
  "Generate a summary of the user's cart with suggestions",
  {
    userId: z.string().describe("User ID"),
  },
  ({ userId }) => {
    const cart = carts.get(userId);
    if (!cart || cart.items.length === 0) {
      return {
        messages: [
          { role: "system", content: "You are a shopping assistant." },
          { role: "user", content: "The user's cart is empty. Suggest some popular products to get them started." },
        ],
      };
    }

    const items = cart.items.map(i => {
      const p = products.get(i.productId);
      return p ? `- ${i.quantity}x ${p.name} @ $${p.price} each = $${(i.quantity * p.price).toFixed(2)}` : null;
    }).filter(Boolean).join("\n");

    return {
      messages: [
        {
          role: "system",
          content: "You are a helpful shopping assistant. Provide a clear cart summary and suggest complementary products or savings opportunities.",
        },
        {
          role: "user",
          content: `Cart Summary:\n${items}\n\nSubtotal: $${cart.total.toFixed(2)}\n\nPlease summarize this cart and suggest any complementary products or money-saving tips.`,
        },
      ],
    };
  }
);

// ============================================
// HEALTH CHECK
// ============================================

server.tool(
  "health",
  "Health check endpoint",
  {},
  async () => {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "healthy",
          timestamp: new Date().toISOString(),
          products: products.size,
          activeCarts: carts.size,
        }, null, 2),
      }],
    };
  }
);

// Start server
async function main() {
  const transport = process.env.MCP_TRANSPORT || "websocket";
  const port = parseInt(process.env.MCP_PORT || "3000", 10);
  const host = process.env.MCP_HOST || "0.0.0.0";

  console.error(`Starting ecommerce-catalog on ${transport}...`);

  if (transport === "websocket") {
    await server.start({ transport: "websocket", port, host });
  } else if (transport === "http-sse") {
    await server.start({ transport: "http-sse", port, host });
  } else if (transport === "grpc") {
    await server.start({ transport: "grpc", port, host });
  } else {
    await server.start({ transport: "stdio" });
  }

  console.error("E-commerce catalog server started successfully");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});