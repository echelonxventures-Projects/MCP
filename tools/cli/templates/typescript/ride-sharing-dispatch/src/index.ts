/**
 * Ride-Sharing Dispatch MCP Server
 * Driver matching, routing, real-time tracking, and pricing
 */

import { McpServer, tool, resource, prompt } from "@mcp/server";
import { z } from "zod";

// Type definitions
interface Location {
  lat: number;
  lng: number;
  address?: string;
}

interface Driver {
  id: string;
  name: string;
  vehicle: {
    type: "sedan" | "suv" | "van" | "bike" | "scooter";
    model: string;
    licensePlate: string;
    capacity: number;
  };
  location: Location;
  status: "available" | "busy" | "offline";
  rating: number;
  tripsCompleted: number;
  currentTripId?: string;
}

interface Rider {
  id: string;
  name: string;
  location: Location;
  destination: Location;
  status: "waiting" | "matched" | "enroute" | "completed" | "cancelled";
  currentTripId?: string;
  preferences: {
    vehicleType?: "sedan" | "suv" | "van" | "bike" | "scooter";
    maxWaitTime?: number; // minutes
  };
}

interface Trip {
  id: string;
  riderId: string;
  driverId?: string;
  pickup: Location;
  dropoff: Location;
  status: "requested" | "matched" | "driver_enroute" | "arrived" | "in_progress" | "completed" | "cancelled";
  distance: number; // km
  estimatedDuration: number; // minutes
  estimatedPrice: number;
  actualPrice?: number;
  startedAt?: string;
  completedAt?: string;
  route?: Location[];
}

// Mock data stores
const drivers: Map<string, Driver> = new Map();
const riders: Map<string, Rider> = new Map();
const trips: Map<string, Trip> = new Map();

// Initialize sample data
function initializeSampleData() {
  // Sample drivers
  const sampleDrivers: Driver[] = [
    {
      id: "drv-001",
      name: "John Smith",
      vehicle: { type: "sedan", model: "Toyota Camry", licensePlate: "ABC-123", capacity: 4 },
      location: { lat: 37.7749, lng: -122.4194, address: "Downtown SF" },
      status: "available",
      rating: 4.9,
      tripsCompleted: 1250,
    },
    {
      id: "drv-002",
      name: "Maria Garcia",
      vehicle: { type: "suv", model: "Honda Pilot", licensePlate: "XYZ-789", capacity: 6 },
      location: { lat: 37.7849, lng: -122.4094, address: "Mission District" },
      status: "available",
      rating: 4.8,
      tripsCompleted: 980,
    },
    {
      id: "drv-003",
      name: "Chen Wei",
      vehicle: { type: "van", model: "Mercedes Sprinter", licensePlate: "VAN-456", capacity: 12 },
      location: { lat: 37.7649, lng: -122.4294, address: "SOMA" },
      status: "available",
      rating: 4.7,
      tripsCompleted: 650,
    },
  ];

  for (const driver of sampleDrivers) {
    drivers.set(driver.id, driver);
  }

  // Sample riders
  const sampleRiders: Rider[] = [
    {
      id: "rdr-001",
      name: "Alice Johnson",
      location: { lat: 37.7749, lng: -122.4194, address: "Union Square" },
      destination: { lat: 37.7849, lng: -122.4094, address: "Mission District" },
      status: "waiting",
      preferences: { vehicleType: "sedan", maxWaitTime: 10 },
    },
  ];

  for (const rider of sampleRiders) {
    riders.set(rider.id, rider);
  }
}

initializeSampleData();

// Helper: Calculate distance (Haversine formula)
function calculateDistance(loc1: Location, loc2: Location): number {
  const R = 6371; // Earth radius in km
  const dLat = (loc2.lat - loc1.lat) * Math.PI / 180;
  const dLng = (loc2.lng - loc1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper: Find nearest available drivers
function findNearestDrivers(pickup: Location, vehicleType?: string, maxDistance: number = 10): Driver[] {
  const available = Array.from(drivers.values()).filter(d => d.status === "available");

  let candidates = available;
  if (vehicleType) {
    candidates = candidates.filter(d => d.vehicle.type === vehicleType);
  }

  return candidates
    .map(d => ({ driver: d, distance: calculateDistance(pickup, d.location) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .map(({ driver }) => driver);
}

// Create MCP server
const server = new McpServer({
  name: "ride-sharing-dispatch",
  version: "2.1.0",
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

// Request a ride
server.tool(
  "request-ride",
  "Request a new ride",
  {
    riderId: z.string().describe("Rider ID"),
    pickup: z.object({
      lat: z.number(),
      lng: z.number(),
      address: z.string().optional(),
    }).describe("Pickup location"),
    dropoff: z.object({
      lat: z.number(),
      lng: z.number(),
      address: z.string().optional(),
    }).describe("Drop-off location"),
    vehicleType: z.enum(["sedan", "suv", "van", "bike", "scooter"]).optional().describe("Preferred vehicle type"),
    maxWaitTime: z.number().int().positive().optional().describe("Maximum wait time in minutes"),
  },
  async ({ riderId, pickup, dropoff, vehicleType, maxWaitTime = 10 }) => {
    const rider = riders.get(riderId);
    if (!rider) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Rider not found" }) }], isError: true };
    }

    const distance = calculateDistance(pickup, dropoff);
    const estimatedDuration = Math.ceil(distance * 3); // ~20 km/h average
    const baseFare = 5.0;
    const perKm = 2.5;
    const estimatedPrice = Math.round((baseFare + distance * perKm) * 100) / 100;

    const tripId = `trip-${Date.now()}`;
    const trip: Trip = {
      id: tripId,
      riderId,
      pickup,
      dropoff,
      status: "requested",
      distance,
      estimatedDuration,
      estimatedPrice,
      route: [pickup, dropoff], // Simplified
    };

    trips.set(tripId, trip);
    rider.status = "waiting";
    rider.currentTripId = tripId;
    rider.destination = dropoff;
    riders.set(riderId, rider);

    // Find nearby drivers
    const nearbyDrivers = findNearestDrivers(pickup, vehicleType, maxWaitTime * 0.5);

    if (nearbyDrivers.length > 0) {
      // Auto-match with closest driver
      const matchedDriver = nearbyDrivers[0];
      await matchDriverToTrip(tripId, matchedDriver.id);
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          tripId,
          status: trip.status,
          estimatedPrice,
          estimatedDuration,
          nearbyDrivers: nearbyDrivers.length,
        }, null, 2),
      }],
    };
  }
);

// Match driver to trip
async function matchDriverToTrip(tripId: string, driverId: string): Promise<void> {
  const trip = trips.get(tripId);
  const driver = drivers.get(driverId);

  if (!trip || !driver) return;

  trip.driverId = driverId;
  trip.status = "matched";
  driver.status = "busy";
  driver.currentTripId = tripId;

  const rider = riders.get(trip.riderId);
  if (rider) {
    rider.status = "matched";
    rider.currentTripId = tripId;
    riders.set(rider.id, rider);
  }

  drivers.set(driverId, driver);
  trips.set(tripId, trip);
}

// Accept ride (driver)
server.tool(
  "accept-ride",
  "Driver accepts a ride request",
  {
    driverId: z.string().describe("Driver ID"),
    tripId: z.string().describe("Trip ID"),
  },
  async ({ driverId, tripId }) => {
    const driver = drivers.get(driverId);
    const trip = trips.get(tripId);

    if (!driver || !trip) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Driver or trip not found" }) }], isError: true };
    }

    if (driver.status !== "available" && driver.currentTripId !== tripId) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Driver not available" }) }], isError: true };
    }

    await matchDriverToTrip(tripId, driverId);

    return { content: [{ type: "text", text: JSON.stringify({ success: true, trip: trips.get(tripId) }, null, 2) }] };
  }
);

// Start trip
server.tool(
  "start-trip",
  "Driver starts the trip (arrived at pickup)",
  {
    driverId: z.string().describe("Driver ID"),
    tripId: z.string().describe("Trip ID"),
  },
  async ({ driverId, tripId }) => {
    const trip = trips.get(tripId);
    const driver = drivers.get(driverId);

    if (!trip || !driver || trip.driverId !== driverId) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Invalid trip or driver" }) }], isError: true };
    }

    trip.status = "in_progress";
    trip.startedAt = new Date().toISOString();
    trips.set(tripId, trip);

    const rider = riders.get(trip.riderId);
    if (rider) {
      rider.status = "enroute";
      riders.set(rider.id, rider);
    }

    return { content: [{ type: "text", text: JSON.stringify(trip, null, 2) }] };
  }
);

// Complete trip
server.tool(
  "complete-trip",
  "Complete the trip",
  {
    driverId: z.string().describe("Driver ID"),
    tripId: z.string().describe("Trip ID"),
    actualDistance: z.number().positive().optional().describe("Actual distance traveled (km)"),
  },
  async ({ driverId, tripId, actualDistance }) => {
    const trip = trips.get(tripId);
    const driver = drivers.get(driverId);

    if (!trip || !driver || trip.driverId !== driverId) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Invalid trip or driver" }) }], isError: true };
    }

    trip.status = "completed";
    trip.completedAt = new Date().toISOString();

    if (actualDistance) {
      trip.distance = actualDistance;
      // Recalculate price based on actual distance
      const baseFare = 5.0;
      const perKm = 2.5;
      trip.actualPrice = Math.round((baseFare + actualDistance * perKm) * 100) / 100;
    } else {
      trip.actualPrice = trip.estimatedPrice;
    }

    trips.set(tripId, trip);

    // Update driver
    driver.status = "available";
    driver.currentTripId = undefined;
    driver.tripsCompleted += 1;
    drivers.set(driverId, driver);

    // Update rider
    const rider = riders.get(trip.riderId);
    if (rider) {
      rider.status = "completed";
      rider.currentTripId = undefined;
      riders.set(rider.id, rider);
    }

    return { content: [{ type: "text", text: JSON.stringify(trip, null, 2) }] };
  }
);

// Cancel trip
server.tool(
  "cancel-trip",
  "Cancel a trip",
  {
    tripId: z.string().describe("Trip ID"),
    reason: z.string().optional().describe("Cancellation reason"),
    cancelledBy: z.enum(["rider", "driver"]).describe("Who cancelled"),
  },
  async ({ tripId, reason, cancelledBy }) => {
    const trip = trips.get(tripId);
    if (!trip) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Trip not found" }) }], isError: true };
    }

    trip.status = "cancelled";
    trips.set(tripId, trip);

    // Update driver
    if (trip.driverId) {
      const driver = drivers.get(trip.driverId);
      if (driver) {
        driver.status = "available";
        driver.currentTripId = undefined;
        drivers.set(driver.id, driver);
      }
    }

    // Update rider
    const rider = riders.get(trip.riderId);
    if (rider) {
      rider.status = "cancelled";
      rider.currentTripId = undefined;
      riders.set(rider.id, rider);
    }

    return { content: [{ type: "text", text: JSON.stringify({ success: true, trip, cancelledBy, reason }, null, 2) }] };
  }
);

// Get trip status
server.tool(
  "get-trip-status",
  "Get current trip status",
  {
    tripId: z.string().describe("Trip ID"),
  },
  async ({ tripId }) => {
    const trip = trips.get(tripId);
    if (!trip) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Trip not found" }) }], isError: true };
    }

    const driver = trip.driverId ? drivers.get(trip.driverId) : undefined;
    const rider = riders.get(trip.riderId);

    return { content: [{ type: "text", text: JSON.stringify({ trip, driver, rider }, null, 2) }] };
  }
);

// Get nearby drivers
server.tool(
  "get-nearby-drivers",
  "Find nearby available drivers",
  {
    location: z.object({
      lat: z.number(),
      lng: z.number(),
      address: z.string().optional(),
    }).describe("Search location"),
    vehicleType: z.enum(["sedan", "suv", "van", "bike", "scooter"]).optional().describe("Vehicle type filter"),
    maxDistance: z.number().positive().optional().default(10).describe("Max distance in km"),
  },
  async ({ location, vehicleType, maxDistance = 10 }) => {
    const nearbyDrivers = findNearestDrivers(location, vehicleType, maxDistance);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          drivers: nearbyDrivers.map(d => ({
            id: d.id,
            name: d.name,
            vehicle: d.vehicle,
            location: d.location,
            rating: d.rating,
            distance: calculateDistance(location, d.location),
          })),
        }, null, 2),
      }],
    };
  }
);

// Update driver location
server.tool(
  "update-driver-location",
  "Update driver's current location",
  {
    driverId: z.string().describe("Driver ID"),
    location: z.object({
      lat: z.number(),
      lng: z.number(),
      address: z.string().optional(),
    }).describe("New location"),
  },
  async ({ driverId, location }) => {
    const driver = drivers.get(driverId);
    if (!driver) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Driver not found" }) }], isError: true };
    }

    driver.location = location;
    drivers.set(driverId, driver);

    // If driver has active trip, update trip route
    if (driver.currentTripId) {
      const trip = trips.get(driver.currentTripId);
      if (trip && trip.route) {
        trip.route.push(location);
      }
    }

    return { content: [{ type: "text", text: JSON.stringify({ success: true, driver }, null, 2) }] };
  }
);

// Get fare estimate
server.tool(
  "get-fare-estimate",
  "Get fare estimate for a trip",
  {
    pickup: z.object({ lat: z.number(), lng: z.number() }).describe("Pickup location"),
    dropoff: z.object({ lat: z.number(), lng: z.number() }).describe("Drop-off location"),
    vehicleType: z.enum(["sedan", "suv", "van", "bike", "scooter"]).optional().describe("Vehicle type"),
  },
  async ({ pickup, dropoff, vehicleType }) => {
    const distance = calculateDistance(pickup, dropoff);
    const duration = Math.ceil(distance * 3);

    const baseRates = { sedan: 2.5, suv: 3.5, van: 4.5, bike: 1.5, scooter: 1.0 };
    const perKm = vehicleType ? baseRates[vehicleType] : baseRates.sedan;
    const baseFare = vehicleType === "bike" || vehicleType === "scooter" ? 2.0 : 5.0;

    const estimatedPrice = Math.round((baseFare + distance * perKm) * 100) / 100;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          distance: Math.round(distance * 100) / 100,
          estimatedDuration: duration,
          estimatedPrice,
          currency: "USD",
          vehicleType: vehicleType || "sedan",
        }, null, 2),
      }],
    };
  }
);

// ============================================
// RESOURCES
// ============================================

// Active trips resource
server.resource(
  "trips://active",
  "All active trips",
  async (uri) => {
    const activeTrips = Array.from(trips.values()).filter(
      t => ["requested", "matched", "driver_enroute", "arrived", "in_progress"].includes(t.status)
    );

    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ trips: activeTrips, count: activeTrips.length }, null, 2),
      }],
    };
  }
);

// Single trip resource
server.resource(
  "trip://{tripId}",
  "Trip details",
  async (uri) => {
    const trip = trips.get(uri.params.tripId);
    if (!trip) {
      throw new Error(`Trip not found: ${uri.params.tripId}`);
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(trip, null, 2),
      }],
    };
  }
);

// Driver resource
server.resource(
  "driver://{driverId}",
  "Driver information",
  async (uri) => {
    const driver = drivers.get(uri.params.driverId);
    if (!driver) {
      throw new Error(`Driver not found: ${uri.params.driverId}`);
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(driver, null, 2),
      }],
    };
  }
);

// Available drivers resource
server.resource(
  "drivers://available",
  "All available drivers",
  async (uri) => {
    const availableDrivers = Array.from(drivers.values()).filter(d => d.status === "available");

    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ drivers: availableDrivers, count: availableDrivers.length }, null, 2),
      }],
    };
  }
);

// ============================================
// PROMPTS
// ============================================

// Ride summary prompt
server.prompt(
  "ride-summary",
  "Generate a summary of a completed ride",
  {
    tripId: z.string().describe("Trip ID"),
  },
  ({ tripId }) => {
    const trip = trips.get(tripId);
    if (!trip) {
      return {
        messages: [
          { role: "system", content: "You are a ride-sharing assistant." },
          { role: "user", content: `Trip ${tripId} not found.` },
        ],
      };
    }

    const driver = trip.driverId ? drivers.get(trip.driverId) : null;
    const rider = riders.get(trip.riderId);

    return {
      messages: [
        {
          role: "system",
          content: "You are a helpful ride-sharing assistant. Provide a clear, friendly summary of the completed ride.",
        },
        {
          role: "user",
          content: `Trip Summary:\n- Trip ID: ${trip.id}\n- Rider: ${rider?.name || "Unknown"}\n- Driver: ${driver?.name || "Unknown"}\n- Pickup: ${trip.pickup.address || `${trip.pickup.lat}, ${trip.pickup.lng}`}\n- Dropoff: ${trip.dropoff.address || `${trip.dropoff.lat}, ${trip.dropoff.lng}`}\n- Distance: ${trip.distance.toFixed(1)} km\n- Duration: ${trip.estimatedDuration} min\n- Fare: $${trip.actualPrice?.toFixed(2) || trip.estimatedPrice.toFixed(2)}\n- Status: ${trip.status}\n\nPlease provide a friendly summary for the rider.`,
        },
      ],
    };
  }
);

// Driver earnings prompt
server.prompt(
  "driver-earnings",
  "Generate driver earnings report",
  {
    driverId: z.string().describe("Driver ID"),
    period: z.enum(["today", "week", "month"]).optional().default("today").describe("Time period"),
  },
  ({ driverId, period = "today" }) => {
    const driver = drivers.get(driverId);
    if (!driver) {
      return {
        messages: [
          { role: "system", content: "You are a driver support assistant." },
          { role: "user", content: `Driver ${driverId} not found.` },
        ],
      };
    }

    // Filter trips for this driver
    const driverTrips = Array.from(trips.values()).filter(t => t.driverId === driverId && t.status === "completed");

    return {
      messages: [
        {
          role: "system",
          content: "You are a driver support assistant. Provide a clear earnings summary.",
        },
        {
          role: "user",
          content: `Driver: ${driver.name} (${driver.id})\nVehicle: ${driver.vehicle.type} ${driver.vehicle.model}\nTotal Trips: ${driver.tripsCompleted}\nRating: ${driver.rating}/5.0\nCompleted Trips This Period: ${driverTrips.length}\n\nPlease provide an earnings summary for ${period}.`,
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
          drivers: drivers.size,
          activeDrivers: Array.from(drivers.values()).filter(d => d.status === "available").length,
          riders: riders.size,
          activeTrips: Array.from(trips.values()).filter(t => !["completed", "cancelled"].includes(t.status)).length,
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

  console.error(`Starting ride-sharing-dispatch on ${transport}...`);

  if (transport === "websocket") {
    await server.start({ transport: "websocket", port, host });
  } else if (transport === "http-sse") {
    await server.start({ transport: "http-sse", port, host });
  } else if (transport === "grpc") {
    await server.start({ transport: "grpc", port, host });
  } else {
    await server.start({ transport: "stdio" });
  }

  console.error("Ride-sharing dispatch server started successfully");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});