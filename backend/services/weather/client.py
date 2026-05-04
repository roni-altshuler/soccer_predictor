"""
Weather API Client for fetching match conditions.

Uses OpenWeatherMap API and historical weather data to provide:
- Real-time weather for upcoming matches
- Historical weather impact analysis
- Weather-based prediction adjustments
"""

import asyncio
import os
from typing import Optional, Dict, List, Any
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
import httpx
import logging

logger = logging.getLogger(__name__)


class WeatherImpact(str, Enum):
    """Weather impact on match conditions."""
    FAVORABLE = "favorable"
    NEUTRAL = "neutral"
    CHALLENGING = "challenging"
    SEVERE = "severe"


@dataclass
class WeatherData:
    """Weather data for a match venue."""
    venue: str
    city: str
    country: str
    temperature: float  # Celsius
    feels_like: float
    humidity: int  # percentage
    wind_speed: float  # m/s
    wind_direction: int  # degrees
    conditions: str
    description: str
    icon: str
    precipitation: float  # mm
    precipitation_probability: float
    visibility: int  # meters
    pressure: int  # hPa
    cloud_cover: int  # percentage
    impact: WeatherImpact
    impact_description: str
    timestamp: datetime

    def to_dict(self) -> Dict[str, Any]:
        return {
            "venue": self.venue,
            "city": self.city,
            "country": self.country,
            "temperature": round(self.temperature, 1),
            "feelsLike": round(self.feels_like, 1),
            "humidity": self.humidity,
            "windSpeed": round(self.wind_speed, 1),
            "windDirection": self.wind_direction,
            "conditions": self.conditions,
            "description": self.description,
            "icon": self.icon,
            "precipitation": round(self.precipitation, 1),
            "precipitationProbability": round(self.precipitation_probability, 2),
            "visibility": self.visibility,
            "cloudCover": self.cloud_cover,
            "pressure": self.pressure,
            "impact": self.impact.value,
            "impactDescription": self.impact_description,
            "timestamp": self.timestamp.isoformat(),
        }


# Stadium coordinates database
STADIUM_COORDINATES: Dict[str, Dict[str, Any]] = {
    # Premier League
    "arsenal": {"city": "London", "country": "UK", "lat": 51.5549, "lon": -0.1084, "stadium": "Emirates Stadium"},
    "chelsea": {"city": "London", "country": "UK", "lat": 51.4817, "lon": -0.1910, "stadium": "Stamford Bridge"},
    "liverpool": {"city": "Liverpool", "country": "UK", "lat": 53.4308, "lon": -2.9608, "stadium": "Anfield"},
    "manchester city": {"city": "Manchester", "country": "UK", "lat": 53.4831, "lon": -2.2004, "stadium": "Etihad Stadium"},
    "manchester united": {"city": "Manchester", "country": "UK", "lat": 53.4631, "lon": -2.2913, "stadium": "Old Trafford"},
    "tottenham": {"city": "London", "country": "UK", "lat": 51.6042, "lon": -0.0662, "stadium": "Tottenham Hotspur Stadium"},
    "newcastle united": {"city": "Newcastle", "country": "UK", "lat": 54.9756, "lon": -1.6215, "stadium": "St. James' Park"},
    "aston villa": {"city": "Birmingham", "country": "UK", "lat": 52.5091, "lon": -1.8849, "stadium": "Villa Park"},
    "west ham": {"city": "London", "country": "UK", "lat": 51.5386, "lon": -0.0166, "stadium": "London Stadium"},
    "brighton": {"city": "Brighton", "country": "UK", "lat": 50.8619, "lon": -0.0833, "stadium": "Amex Stadium"},
    "fulham": {"city": "London", "country": "UK", "lat": 51.4750, "lon": -0.2217, "stadium": "Craven Cottage"},
    "everton": {"city": "Liverpool", "country": "UK", "lat": 53.4389, "lon": -2.9664, "stadium": "Goodison Park"},
    "wolves": {"city": "Wolverhampton", "country": "UK", "lat": 52.5903, "lon": -2.1306, "stadium": "Molineux"},
    "bournemouth": {"city": "Bournemouth", "country": "UK", "lat": 50.7353, "lon": -1.8383, "stadium": "Vitality Stadium"},
    "brentford": {"city": "London", "country": "UK", "lat": 51.4908, "lon": -0.2892, "stadium": "Gtech Community Stadium"},
    "crystal palace": {"city": "London", "country": "UK", "lat": 51.3983, "lon": -0.0858, "stadium": "Selhurst Park"},
    "nottingham forest": {"city": "Nottingham", "country": "UK", "lat": 52.9400, "lon": -1.1328, "stadium": "City Ground"},
    "leicester city": {"city": "Leicester", "country": "UK", "lat": 52.6203, "lon": -1.1422, "stadium": "King Power Stadium"},
    "ipswich town": {"city": "Ipswich", "country": "UK", "lat": 52.0545, "lon": 1.1447, "stadium": "Portman Road"},
    "southampton": {"city": "Southampton", "country": "UK", "lat": 50.9058, "lon": -1.3911, "stadium": "St Mary's Stadium"},
    
    # La Liga
    "real madrid": {"city": "Madrid", "country": "Spain", "lat": 40.4531, "lon": -3.6883, "stadium": "Santiago Bernabéu"},
    "barcelona": {"city": "Barcelona", "country": "Spain", "lat": 41.3809, "lon": 2.1228, "stadium": "Camp Nou"},
    "atletico madrid": {"city": "Madrid", "country": "Spain", "lat": 40.4361, "lon": -3.5995, "stadium": "Civitas Metropolitano"},
    "sevilla": {"city": "Seville", "country": "Spain", "lat": 37.3840, "lon": -5.9706, "stadium": "Ramón Sánchez-Pizjuán"},
    "real betis": {"city": "Seville", "country": "Spain", "lat": 37.3564, "lon": -5.9814, "stadium": "Benito Villamarín"},
    "athletic club": {"city": "Bilbao", "country": "Spain", "lat": 43.2644, "lon": -2.9494, "stadium": "San Mamés"},
    "villarreal": {"city": "Villarreal", "country": "Spain", "lat": 39.9443, "lon": -0.1036, "stadium": "Estadio de la Cerámica"},
    "real sociedad": {"city": "San Sebastián", "country": "Spain", "lat": 43.3017, "lon": -1.9736, "stadium": "Reale Arena"},
    
    # Serie A
    "inter": {"city": "Milan", "country": "Italy", "lat": 45.4781, "lon": 9.1240, "stadium": "San Siro"},
    "milan": {"city": "Milan", "country": "Italy", "lat": 45.4781, "lon": 9.1240, "stadium": "San Siro"},
    "juventus": {"city": "Turin", "country": "Italy", "lat": 45.1096, "lon": 7.6412, "stadium": "Allianz Stadium"},
    "napoli": {"city": "Naples", "country": "Italy", "lat": 40.8280, "lon": 14.1930, "stadium": "Diego Armando Maradona"},
    "roma": {"city": "Rome", "country": "Italy", "lat": 41.9341, "lon": 12.4547, "stadium": "Stadio Olimpico"},
    "lazio": {"city": "Rome", "country": "Italy", "lat": 41.9341, "lon": 12.4547, "stadium": "Stadio Olimpico"},
    "atalanta": {"city": "Bergamo", "country": "Italy", "lat": 45.7089, "lon": 9.6808, "stadium": "Gewiss Stadium"},
    "fiorentina": {"city": "Florence", "country": "Italy", "lat": 43.7808, "lon": 11.2822, "stadium": "Stadio Artemio Franchi"},
    
    # Bundesliga
    "bayern munich": {"city": "Munich", "country": "Germany", "lat": 48.2188, "lon": 11.6247, "stadium": "Allianz Arena"},
    "dortmund": {"city": "Dortmund", "country": "Germany", "lat": 51.4926, "lon": 7.4518, "stadium": "Signal Iduna Park"},
    "rb leipzig": {"city": "Leipzig", "country": "Germany", "lat": 51.3458, "lon": 12.3483, "stadium": "Red Bull Arena"},
    "leverkusen": {"city": "Leverkusen", "country": "Germany", "lat": 51.0383, "lon": 7.0022, "stadium": "BayArena"},
    "eint frankfurt": {"city": "Frankfurt", "country": "Germany", "lat": 50.0686, "lon": 8.6453, "stadium": "Deutsche Bank Park"},
    "wolfsburg": {"city": "Wolfsburg", "country": "Germany", "lat": 52.4328, "lon": 10.8042, "stadium": "Volkswagen Arena"},
    "union berlin": {"city": "Berlin", "country": "Germany", "lat": 52.4572, "lon": 13.5681, "stadium": "Stadion An der Alten Försterei"},
    
    # Ligue 1
    "paris saint-germain": {"city": "Paris", "country": "France", "lat": 48.8414, "lon": 2.2530, "stadium": "Parc des Princes"},
    "paris s-g": {"city": "Paris", "country": "France", "lat": 48.8414, "lon": 2.2530, "stadium": "Parc des Princes"},
    "marseille": {"city": "Marseille", "country": "France", "lat": 43.2698, "lon": 5.3958, "stadium": "Stade Vélodrome"},
    "lyon": {"city": "Lyon", "country": "France", "lat": 45.7652, "lon": 4.9821, "stadium": "Groupama Stadium"},
    "monaco": {"city": "Monaco", "country": "Monaco", "lat": 43.7274, "lon": 7.4157, "stadium": "Stade Louis II"},
    "lille": {"city": "Lille", "country": "France", "lat": 50.6119, "lon": 3.1303, "stadium": "Stade Pierre-Mauroy"},
    
    # Default fallback
    "default": {"city": "London", "country": "UK", "lat": 51.5074, "lon": -0.1278, "stadium": "Unknown"},
}


class WeatherService:
    """Service for fetching and analyzing weather data for matches."""
    
    BASE_URL = "https://api.openweathermap.org/data/2.5"
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("OPENWEATHER_API_KEY")
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=10.0)
        return self._client
    
    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
    
    def _get_stadium_coords(self, team_name: str) -> Dict[str, Any]:
        """Get stadium coordinates for a team."""
        team_key = team_name.lower().strip()
        
        # Try exact match first
        if team_key in STADIUM_COORDINATES:
            return STADIUM_COORDINATES[team_key]
        
        # Try partial match
        for key, coords in STADIUM_COORDINATES.items():
            if key in team_key or team_key in key:
                return coords
        
        return STADIUM_COORDINATES["default"]
    
    def _calculate_impact(
        self,
        temperature: float,
        wind_speed: float,
        precipitation: float,
        humidity: int,
        visibility: int
    ) -> tuple[WeatherImpact, str]:
        """Calculate weather impact on match."""
        issues = []
        severity = 0
        
        # Temperature checks
        if temperature < 0:
            issues.append("Freezing conditions may affect ball control")
            severity += 2
        elif temperature < 5:
            issues.append("Cold conditions may impact player performance")
            severity += 1
        elif temperature > 32:
            issues.append("Hot conditions require hydration breaks")
            severity += 2
        elif temperature > 28:
            issues.append("Warm conditions may cause fatigue")
            severity += 1
        
        # Wind checks
        if wind_speed > 15:
            issues.append("Strong winds significantly affect long balls and crosses")
            severity += 2
        elif wind_speed > 10:
            issues.append("Moderate winds may affect set pieces")
            severity += 1
        
        # Rain/precipitation checks
        if precipitation > 10:
            issues.append("Heavy rain creates slippery conditions")
            severity += 2
        elif precipitation > 2:
            issues.append("Light rain may affect ball movement")
            severity += 1
        
        # Humidity
        if humidity > 85:
            issues.append("High humidity increases fatigue")
            severity += 1
        
        # Visibility
        if visibility < 1000:
            issues.append("Poor visibility affects gameplay")
            severity += 2
        elif visibility < 5000:
            issues.append("Reduced visibility")
            severity += 1
        
        # Determine impact level
        if severity >= 4:
            impact = WeatherImpact.SEVERE
        elif severity >= 2:
            impact = WeatherImpact.CHALLENGING
        elif severity >= 1:
            impact = WeatherImpact.NEUTRAL
        else:
            impact = WeatherImpact.FAVORABLE
            issues = ["Ideal playing conditions"]
        
        return impact, "; ".join(issues) if issues else "Normal conditions"
    
    async def get_weather_for_venue(
        self,
        home_team: str,
        match_time: Optional[datetime] = None
    ) -> WeatherData:
        """
        Get weather data for a match venue.
        
        Args:
            home_team: Name of the home team
            match_time: Optional datetime for forecast
        
        Returns:
            WeatherData object with conditions and impact
        """
        coords = self._get_stadium_coords(home_team)
        
        if self.api_key:
            try:
                return await self._fetch_real_weather(coords, match_time)
            except Exception as e:
                logger.warning(f"Failed to fetch real weather: {e}")

        if os.getenv("ALLOW_SIMULATED_WEATHER", "").lower() in {"1", "true", "yes"}:
            return self._simulate_weather(coords, match_time)

        raise RuntimeError("Real weather data unavailable. Set OPENWEATHER_API_KEY to enable match weather.")
    
    async def _fetch_real_weather(
        self,
        coords: Dict[str, Any],
        match_time: Optional[datetime]
    ) -> WeatherData:
        """Fetch real weather data from OpenWeatherMap API."""
        client = await self._get_client()
        
        if match_time and match_time > datetime.now() + timedelta(hours=3):
            # Use forecast API for future matches
            url = f"{self.BASE_URL}/forecast"
        else:
            # Use current weather API
            url = f"{self.BASE_URL}/weather"
        
        params = {
            "lat": coords["lat"],
            "lon": coords["lon"],
            "appid": self.api_key,
            "units": "metric",
        }
        
        response = await client.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        
        # For forecast, find closest time
        if "list" in data:
            target_timestamp = match_time.timestamp() if match_time else datetime.now().timestamp()
            closest = min(data["list"], key=lambda x: abs(x["dt"] - target_timestamp))
            weather_info = closest
        else:
            weather_info = data
        
        main = weather_info.get("main", {})
        wind = weather_info.get("wind", {})
        weather = weather_info.get("weather", [{}])[0]
        rain = weather_info.get("rain", {}).get("1h", 0) or weather_info.get("rain", {}).get("3h", 0) / 3
        
        temperature = main.get("temp", 15)
        wind_speed = wind.get("speed", 5)
        humidity = main.get("humidity", 50)
        visibility = weather_info.get("visibility", 10000)
        
        impact, description = self._calculate_impact(
            temperature, wind_speed, rain, humidity, visibility
        )
        
        return WeatherData(
            venue=coords.get("stadium", "Unknown Stadium"),
            city=coords["city"],
            country=coords["country"],
            temperature=temperature,
            feels_like=main.get("feels_like", temperature),
            humidity=humidity,
            wind_speed=wind_speed,
            wind_direction=wind.get("deg", 0),
            conditions=weather.get("main", "Clear"),
            description=weather.get("description", "clear sky"),
            icon=self._get_weather_icon(weather.get("icon", "01d")),
            precipitation=rain,
            precipitation_probability=weather_info.get("pop", 0),
            visibility=visibility,
            pressure=main.get("pressure", 1013),
            cloud_cover=weather_info.get("clouds", {}).get("all", 0),
            impact=impact,
            impact_description=description,
            timestamp=datetime.now(),
        )
    
    def _simulate_weather(
        self,
        coords: Dict[str, Any],
        match_time: Optional[datetime]
    ) -> WeatherData:
        """Generate simulated weather data based on typical conditions."""
        import random
        
        # Base temperature by country (seasonal average)
        country_temps = {
            "UK": 12, "Spain": 20, "Italy": 18, "Germany": 12,
            "France": 14, "Netherlands": 11, "Portugal": 18,
            "Monaco": 18,
        }
        
        base_temp = country_temps.get(coords["country"], 15)
        
        # Add some randomness
        temperature = base_temp + random.uniform(-5, 5)
        humidity = random.randint(40, 80)
        wind_speed = random.uniform(2, 15)
        
        # Weather conditions (weighted towards common conditions)
        conditions = random.choices(
            ["Clear", "Clouds", "Rain", "Drizzle", "Overcast"],
            weights=[30, 35, 15, 10, 10],
            k=1
        )[0]
        
        precipitation = 0
        if conditions in ["Rain", "Drizzle"]:
            precipitation = random.uniform(1, 8)
        
        visibility = random.randint(8000, 15000)
        if conditions == "Rain":
            visibility = random.randint(3000, 8000)
        
        impact, description = self._calculate_impact(
            temperature, wind_speed, precipitation, humidity, visibility
        )
        
        icons = {
            "Clear": "☀️", "Clouds": "⛅", "Rain": "🌧️",
            "Drizzle": "🌦️", "Overcast": "☁️"
        }
        
        return WeatherData(
            venue=coords.get("stadium", "Unknown Stadium"),
            city=coords["city"],
            country=coords["country"],
            temperature=round(temperature, 1),
            feels_like=round(temperature - wind_speed * 0.3, 1),
            humidity=humidity,
            wind_speed=round(wind_speed, 1),
            wind_direction=random.randint(0, 359),
            conditions=conditions,
            description=f"{conditions.lower()} conditions",
            icon=icons.get(conditions, "⛅"),
            precipitation=round(precipitation, 1),
            precipitation_probability=random.uniform(0, 0.3) if conditions != "Rain" else random.uniform(0.6, 1.0),
            visibility=visibility,
            pressure=random.randint(1000, 1025),
            cloud_cover=random.randint(0, 100),
            impact=impact,
            impact_description=description,
            timestamp=datetime.now(),
        )
    
    def _get_weather_icon(self, icon_code: str) -> str:
        """Convert OpenWeatherMap icon code to emoji."""
        icons = {
            "01d": "☀️", "01n": "🌙",
            "02d": "⛅", "02n": "☁️",
            "03d": "☁️", "03n": "☁️",
            "04d": "☁️", "04n": "☁️",
            "09d": "🌧️", "09n": "🌧️",
            "10d": "🌦️", "10n": "🌧️",
            "11d": "⛈️", "11n": "⛈️",
            "13d": "❄️", "13n": "❄️",
            "50d": "🌫️", "50n": "🌫️",
        }
        return icons.get(icon_code, "⛅")
    
    def calculate_weather_adjustment(self, weather: WeatherData) -> Dict[str, float]:
        """
        Calculate how weather affects prediction factors.
        
        Returns adjustments to apply to predictions:
        - goal_factor: Multiplier for expected goals
        - home_advantage_boost: Adjustment to home advantage
        - style_factor: Affects playing style expectations
        """
        adjustments = {
            "goal_factor": 1.0,
            "home_advantage_boost": 0.0,
            "attacking_factor": 1.0,
            "set_piece_factor": 1.0,
        }
        
        # Heavy rain typically reduces goals
        if weather.precipitation > 5:
            adjustments["goal_factor"] = 0.9
            adjustments["attacking_factor"] = 0.85
        
        # Strong wind affects set pieces
        if weather.wind_speed > 12:
            adjustments["set_piece_factor"] = 0.8
            adjustments["goal_factor"] *= 0.95
        
        # Extreme temperatures
        if weather.temperature < 5 or weather.temperature > 30:
            adjustments["goal_factor"] *= 0.95
        
        # Home team better adapted to local weather
        if weather.impact in [WeatherImpact.CHALLENGING, WeatherImpact.SEVERE]:
            adjustments["home_advantage_boost"] = 0.05
        
        return adjustments


# Singleton instance
_weather_service: Optional[WeatherService] = None


def get_weather_service() -> WeatherService:
    """Get or create weather service singleton."""
    global _weather_service
    if _weather_service is None:
        _weather_service = WeatherService()
    return _weather_service


async def cleanup_weather_service():
    """Cleanup weather service resources."""
    global _weather_service
    if _weather_service:
        await _weather_service.close()
        _weather_service = None
