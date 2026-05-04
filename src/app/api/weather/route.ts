import { NextRequest, NextResponse } from 'next/server'

interface WeatherData {
  venue: string
  city: string
  country: string
  temperature: number
  feelsLike: number
  humidity: number
  windSpeed: number
  conditions: string
  icon: string
  precipitation: number
  visibility: number
  impact: 'favorable' | 'neutral' | 'challenging'
  impactDescription: string
}

// Stadium locations for major teams
const STADIUM_LOCATIONS: Record<string, { city: string; country: string; lat: number; lon: number }> = {
  // Premier League
  'arsenal': { city: 'London', country: 'UK', lat: 51.5549, lon: -0.1084 },
  'chelsea': { city: 'London', country: 'UK', lat: 51.4817, lon: -0.1910 },
  'liverpool': { city: 'Liverpool', country: 'UK', lat: 53.4308, lon: -2.9608 },
  'manchester city': { city: 'Manchester', country: 'UK', lat: 53.4831, lon: -2.2004 },
  'manchester united': { city: 'Manchester', country: 'UK', lat: 53.4631, lon: -2.2913 },
  'tottenham': { city: 'London', country: 'UK', lat: 51.6042, lon: -0.0662 },
  'newcastle united': { city: 'Newcastle', country: 'UK', lat: 54.9756, lon: -1.6215 },
  'aston villa': { city: 'Birmingham', country: 'UK', lat: 52.5091, lon: -1.8849 },
  // La Liga
  'real madrid': { city: 'Madrid', country: 'Spain', lat: 40.4531, lon: -3.6883 },
  'barcelona': { city: 'Barcelona', country: 'Spain', lat: 41.3809, lon: 2.1228 },
  'atletico madrid': { city: 'Madrid', country: 'Spain', lat: 40.4361, lon: -3.5995 },
  // Serie A
  'inter': { city: 'Milan', country: 'Italy', lat: 45.4781, lon: 9.1240 },
  'milan': { city: 'Milan', country: 'Italy', lat: 45.4781, lon: 9.1240 },
  'juventus': { city: 'Turin', country: 'Italy', lat: 45.1096, lon: 7.6412 },
  'napoli': { city: 'Naples', country: 'Italy', lat: 40.8280, lon: 14.1930 },
  'roma': { city: 'Rome', country: 'Italy', lat: 41.9341, lon: 12.4547 },
  // Bundesliga
  'bayern munich': { city: 'Munich', country: 'Germany', lat: 48.2188, lon: 11.6247 },
  'dortmund': { city: 'Dortmund', country: 'Germany', lat: 51.4926, lon: 7.4518 },
  'rb leipzig': { city: 'Leipzig', country: 'Germany', lat: 51.3458, lon: 12.3483 },
  // Ligue 1
  'paris saint-germain': { city: 'Paris', country: 'France', lat: 48.8414, lon: 2.2530 },
  'marseille': { city: 'Marseille', country: 'France', lat: 43.2698, lon: 5.3958 },
  'lyon': { city: 'Lyon', country: 'France', lat: 45.7652, lon: 4.9821 },
}

// Simulate weather data for a venue
function getSimulatedWeather(venue: string): WeatherData {
  const location = STADIUM_LOCATIONS[venue.toLowerCase()] || { 
    city: 'London', 
    country: 'UK', 
    lat: 51.5074, 
    lon: -0.1278 
  }
  
  // Generate realistic weather based on typical conditions
  const conditions = ['Clear', 'Partly Cloudy', 'Cloudy', 'Light Rain', 'Overcast', 'Windy']
  const icons = ['☀️', '⛅', '☁️', '🌧️', '🌥️', '💨']
  const conditionIdx = Math.floor(Math.random() * conditions.length)
  
  // Temperature varies by region
  let baseTemp = 15
  if (location.country === 'Spain') baseTemp = 20
  else if (location.country === 'Italy') baseTemp = 18
  else if (location.country === 'Germany') baseTemp = 12
  else if (location.country === 'France') baseTemp = 14
  
  const temperature = baseTemp + (Math.random() * 10 - 5)
  const humidity = 40 + Math.random() * 40
  const windSpeed = 5 + Math.random() * 20
  const precipitation = conditions[conditionIdx].includes('Rain') ? 20 + Math.random() * 60 : Math.random() * 10
  
  // Determine impact on match
  let impact: 'favorable' | 'neutral' | 'challenging' = 'neutral'
  let impactDescription = 'Normal playing conditions expected'
  
  if (windSpeed > 20) {
    impact = 'challenging'
    impactDescription = 'Strong winds may affect long balls and set pieces'
  } else if (precipitation > 40) {
    impact = 'challenging'
    impactDescription = 'Wet conditions may slow down play and increase slipping risk'
  } else if (temperature < 5) {
    impact = 'challenging'
    impactDescription = 'Cold conditions may affect player performance'
  } else if (temperature > 30) {
    impact = 'challenging'
    impactDescription = 'Hot conditions may require water breaks'
  } else if (conditions[conditionIdx] === 'Clear' && temperature >= 15 && temperature <= 22) {
    impact = 'favorable'
    impactDescription = 'Ideal playing conditions'
  }
  
  return {
    venue: venue,
    city: location.city,
    country: location.country,
    temperature: Math.round(temperature * 10) / 10,
    feelsLike: Math.round((temperature - windSpeed / 10) * 10) / 10,
    humidity: Math.round(humidity),
    windSpeed: Math.round(windSpeed * 10) / 10,
    conditions: conditions[conditionIdx],
    icon: icons[conditionIdx],
    precipitation: Math.round(precipitation),
    visibility: 10 - (conditions[conditionIdx].includes('Rain') ? 3 : 0),
    impact,
    impactDescription,
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const venue = searchParams.get('venue') || 'Emirates Stadium'
  const team = searchParams.get('team')

  if (process.env.ALLOW_SIMULATED_WEATHER !== 'true') {
    return NextResponse.json(
      { error: 'Real weather data is not configured. Set OPENWEATHER_API_KEY on the backend to enable match weather.' },
      { status: 503 }
    )
  }
  
  try {
    // Use team name to look up venue if provided
    const lookupKey = team || venue
    const weather = getSimulatedWeather(lookupKey)
    
    return NextResponse.json({
      weather,
      source: 'simulated',
      note: 'Weather data is simulated for demonstration. Integrate with a weather API for live data.'
    })
  } catch (error) {
    console.error('Error fetching weather:', error)
    return NextResponse.json(
      { error: 'Failed to fetch weather data' },
      { status: 500 }
    )
  }
}
