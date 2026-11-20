#!/usr/bin/env python3
"""
Ride-Sharing Dispatch MCP Server
Driver matching, routing, real-time tracking, and pricing
"""

import asyncio
import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Optional

from mcp.server import McpServer, tool, resource, prompt
from pydantic import BaseModel, Field


# ============================================
# MODELS
# ============================================

class RideStatus(str, Enum):
    REQUESTED = "requested"
    SEARCHING = "searching"
    DRIVER_ASSIGNED = "driver_assigned"
    DRIVER_EN_ROUTE = "driver_en_route"
    ARRIVED = "arrived"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class DriverStatus(str, Enum):
    OFFLINE = "offline"
    ONLINE = "online"
    BUSY = "busy"
    ON_TRIP = "on_trip"


class VehicleType(str, Enum):
    ECONOMY = "economy"
    COMFORT = "comfort"
    PREMIUM = "premium"
    SUV = "suv"
    VAN = "van"


@dataclass
class Location:
    lat: float
    lng: float
    address: str = ""
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Driver:
    id: str
    name: str
    phone: str
    email: str
    vehicle_type: VehicleType
    vehicle_model: str
    license_plate: str
    status: DriverStatus = DriverStatus.OFFLINE
    current_location: Optional[Location] = None
    rating: float = 5.0
    total_trips: int = 0
    is_available: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Rider:
    id: str
    name: str
    phone: str
    email: str
    payment_methods: List[Dict[str, Any]] = field(default_factory=list)
    rating: float = 5.0
    total_trips: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Ride:
    id: str
    rider_id: str
    driver_id: Optional[str] = None
    pickup: Location = field(default_factory=Location)
    dropoff: Location = field(default_factory=Location)
    status: RideStatus = RideStatus.REQUESTED
    vehicle_type: VehicleType = VehicleType.ECONOMY
    distance_km: float = 0.0
    duration_min: int = 0
    fare: Decimal = Decimal("0.00")
    currency: str = "USD"
    surge_multiplier: float = 1.0
    driver_location: Optional[Location] = None
    route: List[Location] = field(default_factory=list)
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    cancelled_at: Optional[str] = None
    cancellation_reason: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


# ============================================
# IN-MEMORY STORES
# ============================================

drivers: Dict[str, Driver] = {}
riders: Dict[str, Rider] = {}
rides: Dict[str, Ride] = {}


def initialize_sample_data():
    """Initialize sample ride-sharing data."""
    # Sample drivers
    sample_drivers = [
        Driver(
            id="driver-001",
            name="Alex Chen",
            phone="+1-555-0101",
            email="alex.chen@rideshare.com",
            vehicle_type=VehicleType.COMFORT,
            vehicle_model="Toyota Camry 2023",
            license_plate="ABC-1234",
            status=DriverStatus.ONLINE,
            current_location=Location(lat=37.7749, lng=-122.4194, address="Downtown SF"),
            rating=4.9,
            total_trips=1247,
            is_available=True,
        ),
        Driver(
            id="driver-002",
            name="Maria Rodriguez",
            phone="+1-555-0102",
            email="maria.rodriguez@rideshare.com",
            vehicle_type=VehicleType.PREMIUM,
            vehicle_model="Tesla Model 3 2024",
            license_plate="XYZ-7890",
            status=DriverStatus.ONLINE,
            current_location=Location(lat=37.7849, lng=-122.4094, address="SoMa SF"),
            rating=4.95,
            total_trips=892,
            is_available=True,
        ),
        Driver(
            id="driver-003",
            name="James Wilson",
            phone="+1-555-0103",
            email="james.wilson@rideshare.com",
            vehicle_type=VehicleType.SUV,
            vehicle_model="Ford Explorer 2023",
            license_plate="DEF-5678",
            status=DriverStatus.ONLINE,
            current_location=Location(lat=37.7649, lng=-122.4294, address="Mission SF"),
            rating=4.8,
            total_trips=563,
            is_available=True,
        ),
    ]
    for d in sample_drivers:
        drivers[d.id] = d

    # Sample riders
    sample_riders = [
        Rider(
            id="rider-001",
            name="Sarah Johnson",
            phone="+1-555-0201",
            email="sarah.johnson@email.com",
            payment_methods=[{"type": "card", "last4": "4242", "brand": "Visa"}],
            rating=4.9,
            total_trips=87,
        ),
        Rider(
            id="rider-002",
            name="David Kim",
            phone="+1-555-0202",
            email="david.kim@email.com",
            payment_methods=[{"type": "card", "last4": "8888", "brand": "Mastercard"}],
            rating=4.8,
            total_trips=156,
        ),
    ]
    for r in sample_riders:
        riders[r.id] = r


initialize_sample_data()


# ============================================
# HELPER FUNCTIONS
# ============================================

def calculate_distance(loc1: Location, loc2: Location) -> float:
    """Calculate approximate distance in km using Haversine formula."""
    from math import radians, sin, cos, sqrt, atan2
    R = 6371  # Earth radius in km
    lat1, lng1 = radians(loc1.lat), radians(loc1.lng)
    lat2, lng2 = radians(loc2.lat), radians(loc2.lng)
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlng/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    return R * c


def estimate_duration(distance_km: float) -> int:
    """Estimate trip duration in minutes."""
    avg_speed_kmh = 30  # Urban average
    return int((distance_km / avg_speed_kmh) * 60) + 5


def calculate_fare(distance_km: float, duration_min: int, vehicle_type: VehicleType, surge: float = 1.0) -> Decimal:
    """Calculate fare based on distance, duration, vehicle type, and surge."""
    base_fare = Decimal("2.50")
    per_km = {"economy": Decimal("1.20"), "comfort": Decimal("1.50"), "premium": Decimal("2.00"), "suv": Decimal("1.80"), "van": Decimal("2.20")}
    per_min = {"economy": Decimal("0.30"), "comfort": Decimal("0.40"), "premium": Decimal("0.50"), "suv": Decimal("0.45"), "van": Decimal("0.55")}

    fare = base_fare + (per_km[vehicle_type.value] * Decimal(str(distance_km))) + (per_min[vehicle_type.value] * Decimal(str(duration_min)))
    fare = fare * Decimal(str(surge))
    return fare.quantize(Decimal("0.01"))


def find_nearest_driver(pickup: Location, vehicle_type: VehicleType, max_distance_km: float = 10.0) -> Optional[Driver]:
    """Find nearest available driver matching vehicle type."""
    available = [
        d for d in drivers.values()
        if d.is_available and d.status == DriverStatus.ONLINE and d.vehicle_type == vehicle_type and d.current_location
    ]

    if not available:
        # Fallback to any available driver
        available = [
            d for d in drivers.values()
            if d.is_available and d.status == DriverStatus.ONLINE and d.current_location
        ]

    if not available:
        return None

    # Sort by distance
    available.sort(key=lambda d: calculate_distance(pickup, d.current_location!))

    nearest = available[0]
    if calculate_distance(pickup, nearest.current_location!) <= max_distance_km:
        return nearest
    return None


# ============================================
# MCP SERVER
# ============================================

server = McpServer(
    name="ride-sharing-dispatch",
    version="1.0.0",
    capabilities={
        "tools": {"listChanged": True},
        "resources": {"subscribe": True, "listChanged": True},
        "prompts": {"listChanged": True},
        "logging": {},
    },
)


# ============================================
# TOOLS - DRIVER MANAGEMENT
# ============================================

@server.tool("register-driver", "Register a new driver")
async def register_driver(
    name: str,
    phone: str,
    email: str,
    vehicle_type: str,
    vehicle_model: str,
    license_plate: str,
) -> Dict[str, Any]:
    """Register a new driver."""
    driver_id = f"driver-{uuid.uuid4().hex[:8]}"
    driver = Driver(
        id=driver_id,
        name=name,
        phone=phone,
        email=email,
        vehicle_type=VehicleType(vehicle_type),
        vehicle_model=vehicle_model,
        license_plate=license_plate,
    )
    drivers[driver_id] = driver
    return {"driver_id": driver_id, **driver.__dict__}


@server.tool("update-driver-status", "Update driver availability status")
async def update_driver_status(
    driver_id: str,
    status: str,
    location: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Update driver status and location."""
    driver = drivers.get(driver_id)
    if not driver:
        return {"error": "Driver not found", "driver_id": driver_id}

    driver.status = DriverStatus(status)
    driver.is_available = (driver.status == DriverStatus.ONLINE)

    if location:
        driver.current_location = Location(
            lat=location["lat"],
            lng=location["lng"],
            address=location.get("address", ""),
        )

    driver.updated_at = datetime.utcnow().isoformat()
    return {"success": True, "driver": driver.__dict__}


@server.tool("get-driver", "Get driver details")
async def get_driver(driver_id: str) -> Dict[str, Any]:
    """Get driver details."""
    driver = drivers.get(driver_id)
    if not driver:
        return {"error": "Driver not found", "driver_id": driver_id}
    return driver.__dict__


@server.tool("list-drivers", "List drivers with filters")
async def list_drivers(
    status: Optional[str] = None,
    vehicle_type: Optional[str] = None,
    available_only: bool = False,
) -> Dict[str, Any]:
    """List drivers with optional filters."""
    result = list(drivers.values())

    if status:
        result = [d for d in result if d.status.value == status]
    if vehicle_type:
        result = [d for d in result if d.vehicle_type.value == vehicle_type]
    if available_only:
        result = [d for d in result if d.is_available]

    return {"drivers": [d.__dict__ for d in result], "count": len(result)}


# ============================================
# TOOLS - RIDER MANAGEMENT
# ============================================

@server.tool("register-rider", "Register a new rider")
async def register_rider(
    name: str,
    phone: str,
    email: str,
    payment_methods: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Register a new rider."""
    rider_id = f"rider-{uuid.uuid4().hex[:8]}"
    rider = Rider(
        id=rider_id,
        name=name,
        phone=phone,
        email=email,
        payment_methods=payment_methods or [],
    )
    riders[rider_id] = rider
    return {"rider_id": rider_id, **rider.__dict__}


@server.tool("get-rider", "Get rider details")
async def get_rider(rider_id: str) -> Dict[str, Any]:
    """Get rider details."""
    rider = riders.get(rider_id)
    if not rider:
        return {"error": "Rider not found", "rider_id": rider_id}
    return rider.__dict__


# ============================================
# TOOLS - RIDE MANAGEMENT
# ============================================

@server.tool("request-ride", "Request a new ride")
async def request_ride(
    rider_id: str,
    pickup: Dict[str, Any],
    dropoff: Dict[str, Any],
    vehicle_type: str = "economy",
) -> Dict[str, Any]:
    """Request a new ride."""
    rider = riders.get(rider_id)
    if not rider:
        return {"error": "Rider not found", "rider_id": rider_id}

    pickup_loc = Location(lat=pickup["lat"], lng=pickup["lng"], address=pickup.get("address", ""))
    dropoff_loc = Location(lat=dropoff["lat"], lng=dropoff["lng"], address=dropoff.get("address", ""))

    distance = calculate_distance(pickup_loc, dropoff_loc)
    duration = estimate_duration(distance)
    fare = calculate_fare(distance, duration, VehicleType(vehicle_type))

    ride_id = f"ride-{uuid.uuid4().hex[:12]}"
    ride = Ride(
        id=ride_id,
        rider_id=rider_id,
        pickup=pickup_loc,
        dropoff=dropoff_loc,
        vehicle_type=VehicleType(vehicle_type),
        distance_km=distance,
        duration_min=duration,
        fare=fare,
        status=RideStatus.SEARCHING,
    )
    rides[ride_id] = ride

    # Find driver asynchronously
    asyncio.create_task(match_driver(ride_id))

    return {"ride_id": ride_id, **ride.__dict__}


async def match_driver(ride_id: str):
    """Background task to match driver."""
    ride = rides.get(ride_id)
    if not ride:
        return

    driver = find_nearest_driver(ride.pickup, ride.vehicle_type)
    if driver:
        ride.driver_id = driver.id
        ride.status = RideStatus.DRIVER_ASSIGNED
        driver.is_available = False
        driver.status = DriverStatus.ON_TRIP
        ride.driver_location = driver.current_location
        ride.updated_at = datetime.utcnow().isoformat()

        # Simulate driver en route
        await asyncio.sleep(2)
        ride.status = RideStatus.DRIVER_EN_ROUTE
        ride.updated_at = datetime.utcnow().isoformat()
    else:
        ride.status = RideStatus.CANCELLED
        ride.cancellation_reason = "No drivers available"
        ride.updated_at = datetime.utcnow().isoformat()


@server.tool("get-ride", "Get ride details")
async def get_ride(ride_id: str) -> Dict[str, Any]:
    """Get ride details."""
    ride = rides.get(ride_id)
    if not ride:
        return {"error": "Ride not found", "ride_id": ride_id}
    return ride.__dict__


@server.tool("update-ride-status", "Update ride status")
async def update_ride_status(
    ride_id: str,
    status: str,
    driver_location: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Update ride status."""
    ride = rides.get(ride_id)
    if not ride:
        return {"error": "Ride not found", "ride_id": ride_id}

    ride.status = RideStatus(status)
    ride.updated_at = datetime.utcnow().isoformat()

    if driver_location:
        ride.driver_location = Location(
            lat=driver_location["lat"],
            lng=driver_location["lng"],
            address=driver_location.get("address", ""),
        )

    if status == RideStatus.IN_PROGRESS and not ride.started_at:
        ride.started_at = datetime.utcnow().isoformat()
    elif status == RideStatus.COMPLETED:
        ride.completed_at = datetime.utcnow().isoformat()
        if ride.driver_id:
            driver = drivers.get(ride.driver_id)
            if driver:
                driver.is_available = True
                driver.status = DriverStatus.ONLINE
                driver.total_trips += 1
    elif status == RideStatus.CANCELLED:
        ride.cancelled_at = datetime.utcnow().isoformat()
        if ride.driver_id:
            driver = drivers.get(ride.driver_id)
            if driver:
                driver.is_available = True
                driver.status = DriverStatus.ONLINE

    return {"success": True, "ride": ride.__dict__}


@server.tool("cancel-ride", "Cancel a ride")
async def cancel_ride(ride_id: str, reason: str = "") -> Dict[str, Any]:
    """Cancel a ride."""
    ride = rides.get(ride_id)
    if not ride:
        return {"error": "Ride not found", "ride_id": ride_id}

    if ride.status in [RideStatus.COMPLETED, RideStatus.CANCELLED]:
        return {"error": f"Cannot cancel ride in {ride.status.value} status"}

    ride.status = RideStatus.CANCELLED
    ride.cancellation_reason = reason
    ride.cancelled_at = datetime.utcnow().isoformat()
    ride.updated_at = datetime.utcnow().isoformat()

    if ride.driver_id:
        driver = drivers.get(ride.driver_id)
        if driver:
            driver.is_available = True
            driver.status = DriverStatus.ONLINE

    return {"success": True, "ride": ride.__dict__}


@server.tool("get-rider-rides", "Get rider's ride history")
async def get_rider_rides(rider_id: str, limit: int = 20) -> Dict[str, Any]:
    """Get ride history for a rider."""
    rider_rides = [r for r in rides.values() if r.rider_id == rider_id]
    rider_rides.sort(key=lambda r: r.created_at, reverse=True)
    return {"rides": [r.__dict__ for r in rider_rides[:limit]], "total": len(rider_rides)}


@server.tool("get-driver-rides", "Get driver's ride history")
async def get_driver_rides(driver_id: str, limit: int = 20) -> Dict[str, Any]:
    """Get ride history for a driver."""
    driver_rides = [r for r in rides.values() if r.driver_id == driver_id]
    driver_rides.sort(key=lambda r: r.created_at, reverse=True)
    return {"rides": [r.__dict__ for r in driver_rides[:limit]], "total": len(driver_rides)}


@server.tool("estimate-fare", "Estimate fare for a trip")
async def estimate_fare(
    pickup: Dict[str, Any],
    dropoff: Dict[str, Any],
    vehicle_type: str = "economy",
) -> Dict[str, Any]:
    """Estimate fare for a trip."""
    pickup_loc = Location(lat=pickup["lat"], lng=pickup["lng"])
    dropoff_loc = Location(lat=dropoff["lat"], lng=dropoff["lng"])

    distance = calculate_distance(pickup_loc, dropoff_loc)
    duration = estimate_duration(distance)
    fare = calculate_fare(distance, duration, VehicleType(vehicle_type))

    return {
        "distance_km": round(distance, 2),
        "duration_min": duration,
        "fare": str(fare),
        "currency": "USD",
        "vehicle_type": vehicle_type,
        "breakdown": {
            "base": "2.50",
            "distance": str(Decimal("1.20") * Decimal(str(distance))),
            "time": str(Decimal("0.30") * Decimal(str(duration))),
        },
    }


# ============================================
# RESOURCES
# ============================================

@server.resource("driver://{driver_id}", "Driver details")
async def driver_resource(driver_id: str) -> Dict[str, Any]:
    """Driver resource."""
    driver = drivers.get(driver_id)
    if not driver:
        raise ValueError(f"Driver not found: {driver_id}")
    return driver.__dict__


@server.resource("rider://{rider_id}", "Rider details")
async def rider_resource(rider_id: str) -> Dict[str, Any]:
    """Rider resource."""
    rider = riders.get(rider_id)
    if not rider:
        raise ValueError(f"Rider not found: {rider_id}")
    return rider.__dict__


@server.resource("ride://{ride_id}", "Ride details")
async def ride_resource(ride_id: str) -> Dict[str, Any]:
    """Ride resource."""
    ride = rides.get(ride_id)
    if not ride:
        raise ValueError(f"Ride not found: {ride_id}")
    return ride.__dict__


@server.resource("ride://{ride_id}/tracking", "Real-time ride tracking")
async def ride_tracking_resource(ride_id: str) -> Dict[str, Any]:
    """Real-time ride tracking resource."""
    ride = rides.get(ride_id)
    if not ride:
        raise ValueError(f"Ride not found: {ride_id}")

    return {
        "ride_id": ride.id,
        "status": ride.status.value,
        "driver_location": ride.driver_location.__dict__ if ride.driver_location else None,
        "pickup": ride.pickup.__dict__,
        "dropoff": ride.dropoff.__dict__,
        "route": [loc.__dict__ for loc in ride.route],
        "progress": calculate_progress(ride),
    }


def calculate_progress(ride: Ride) -> float:
    """Calculate ride progress percentage."""
    if ride.status in [RideStatus.REQUESTED, RideStatus.SEARCHING, RideStatus.DRIVER_ASSIGNED]:
        return 0.0
    elif ride.status == RideStatus.DRIVER_EN_ROUTE:
        if ride.driver_location:
            total = calculate_distance(ride.pickup, ride.dropoff)
            remaining = calculate_distance(ride.driver_location, ride.pickup)
            if total > 0:
                return max(0, min(50, (1 - remaining/total) * 50))
        return 10.0
    elif ride.status == RideStatus.ARRIVED:
        return 50.0
    elif ride.status == RideStatus.IN_PROGRESS:
        if ride.driver_location:
            total = calculate_distance(ride.pickup, ride.dropoff)
            completed = calculate_distance(ride.pickup, ride.driver_location)
            if total > 0:
                return 50 + min(50, (completed/total) * 50)
        return 75.0
    elif ride.status == RideStatus.COMPLETED:
        return 100.0
    return 0.0


# ============================================
# PROMPTS
# ============================================

@server.prompt("ride-support", "Ride support assistant")
async def ride_support_prompt(ride_id: str, issue: str) -> Dict[str, Any]:
    """Ride support prompt."""
    ride = rides.get(ride_id)
    if not ride:
        return {"messages": [{"role": "user", "content": "Ride not found."}]}

    driver = drivers.get(ride.driver_id) if ride.driver_id else None
    rider = riders.get(ride.rider_id)

    prompt = f"""You are a ride-sharing support agent. Help resolve this issue.

Ride: {ride_id}
Status: {ride.status.value}
Rider: {rider.name if rider else 'Unknown'}
Driver: {driver.name if driver else 'Not assigned'}
Pickup: {ride.pickup.address}
Dropoff: {ride.dropoff.address}
Issue: {issue}

Provide empathetic, actionable support."""

    return {
        "messages": [
            {"role": "system", "content": "You are a helpful ride-sharing support agent. Be empathetic and action-oriented."},
            {"role": "user", "content": prompt},
        ]
    }


@server.prompt("driver-onboarding", "Driver onboarding guide")
async def driver_onboarding_prompt(vehicle_type: str) -> Dict[str, Any]:
    """Driver onboarding prompt."""
    prompt = f"""Create a comprehensive onboarding guide for a new {vehicle_type} driver.

Include:
- App setup and navigation
- Best practices for ratings
- Safety guidelines
- Earnings optimization tips
- Vehicle requirements for {vehicle_type}
- Local regulations"""

    return {
        "messages": [
            {"role": "system", "content": "You are a driver operations expert. Create clear, practical onboarding content."},
            {"role": "user", "content": prompt},
        ]
    }


# ============================================
# HEALTH CHECK
# ============================================

@server.tool("health", "Health check")
async def health() -> Dict[str, Any]:
    """Health check endpoint."""
    online_drivers = sum(1 for d in drivers.values() if d.status == DriverStatus.ONLINE)
    active_rides = sum(1 for r in rides.values() if r.status in [
        RideStatus.SEARCHING, RideStatus.DRIVER_ASSIGNED, RideStatus.DRIVER_EN_ROUTE,
        RideStatus.ARRIVED, RideStatus.IN_PROGRESS
    ])

    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "drivers": {"total": len(drivers), "online": online_drivers},
        "riders": len(riders),
        "rides": {"total": len(rides), "active": active_rides},
    }


# ============================================
# MAIN
# ============================================

async def main():
    transport = os.getenv("MCP_TRANSPORT", "websocket")
    port = int(os.getenv("MCP_PORT", "3000"))
    host = os.getenv("MCP_HOST", "0.0.0.0")

    print(f"Starting ride-sharing-dispatch on {transport}...", file=sys.stderr)

    if transport == "websocket":
        await server.start(transport="websocket", port=port, host=host)
    elif transport == "http-sse":
        await server.start(transport="http-sse", port=port, host=host)
    elif transport == "grpc":
        await server.start(transport="grpc", port=port, host=host)
    else:
        await server.start(transport="stdio")

    print("Ride-sharing dispatch server started", file=sys.stderr)


if __name__ == "__main__":
    import sys
    asyncio.run(main())