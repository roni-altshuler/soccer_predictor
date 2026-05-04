'use client'

import { useState, useEffect } from 'react'

interface WeatherData {
  temperature: number
  feelsLike: number
  humidity: number
  windSpeed: number
  windDirection: string
  description: string
  icon: string
  precipitation?: number
  visibility?: number
  pressure?: number
}

interface WeatherImpact {
  level: 'none' | 'low' | 'moderate' | 'high' | 'severe'
  description: string
  factors: string[]
  predictionAdjustment?: {
    goalsExpected: string
    favorsFastTeam: boolean
    favorsPhysicalTeam: boolean
  }
}

interface MatchWeatherProps {
  matchId: string
  venue?: string
  kickoffTime?: string
  homeTeam?: string
  awayTeam?: string
}

const WEATHER_ICONS: Record<string, string> = {
  'clear': '☀️',
  'clouds': '☁️',
  'rain': '🌧️',
  'drizzle': '🌦️',
  'thunderstorm': '⛈️',
  'snow': '❄️',
  'mist': '🌫️',
  'fog': '🌫️',
  'haze': '🌫️',
  'default': '🌤️'
}

const WIND_DIRECTIONS: Record<string, string> = {
  'N': '↑', 'NE': '↗', 'E': '→', 'SE': '↘',
  'S': '↓', 'SW': '↙', 'W': '←', 'NW': '↖'
}

export default function MatchWeather({ venue, kickoffTime, homeTeam }: MatchWeatherProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [impact, setImpact] = useState<WeatherImpact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchWeather = async () => {
      if (!homeTeam) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const query = new URLSearchParams()
        if (kickoffTime) query.set('match_time', kickoffTime)
        const response = await fetch(`/api/v1/weather/match/${encodeURIComponent(homeTeam)}${query.toString() ? `?${query}` : ''}`)
        
        if (!response.ok) {
          throw new Error('Weather data unavailable')
        }

        const data = await response.json()
        const temperature = Number(data.temperature)
        if (!Number.isFinite(temperature)) {
          throw new Error('Weather data unavailable')
        }
        
        setWeather({
          temperature,
          feelsLike: Number(data.feelsLike ?? data.feels_like ?? temperature),
          humidity: Number(data.humidity ?? 0),
          windSpeed: Number(data.windSpeed ?? data.wind_speed ?? 0),
          windDirection: String(data.windDirection ?? data.wind_direction ?? ''),
          description: String(data.description ?? data.conditions ?? ''),
          icon: String(data.conditions ?? data.weather_condition ?? data.icon ?? 'default'),
          precipitation: data.precipitation,
          visibility: data.visibility,
          pressure: data.pressure
        })

        setImpact({
          level: data.impact || data.impact_level || 'none',
          description: data.impactDescription || data.impact_description || 'Weather impact not provided',
          factors: data.impact_factors || [],
          predictionAdjustment: data.prediction_adjustment
        })
      } catch (err) {
        setWeather(null)
        setImpact(null)
        setError(err instanceof Error ? err.message : 'Weather data unavailable')
      } finally {
        setLoading(false)
      }
    }

    fetchWeather()
  }, [homeTeam, kickoffTime])

  const getImpactColor = (level: string): string => {
    switch (level) {
      case 'none': return 'text-green-500'
      case 'low': return 'text-blue-500'
      case 'moderate': return 'text-amber-500'
      case 'high': return 'text-orange-500'
      case 'severe': return 'text-red-500'
      default: return 'text-[var(--text-secondary)]'
    }
  }

  const getImpactBg = (level: string): string => {
    switch (level) {
      case 'none': return 'bg-green-500/10 border-green-500/30'
      case 'low': return 'bg-blue-500/10 border-blue-500/30'
      case 'moderate': return 'bg-amber-500/10 border-amber-500/30'
      case 'high': return 'bg-orange-500/10 border-orange-500/30'
      case 'severe': return 'bg-red-500/10 border-red-500/30'
      default: return 'bg-[var(--muted-bg)]'
    }
  }

  const getWeatherIcon = (condition: string): string => {
    const key = condition.toLowerCase()
    return WEATHER_ICONS[key] || WEATHER_ICONS['default']
  }

  if (loading) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-xl p-4 animate-pulse" style={{ borderColor: 'var(--border-color)' }}>
        <div className="h-4 bg-[var(--muted-bg)] rounded w-24 mb-3" />
        <div className="h-10 bg-[var(--muted-bg)] rounded w-32 mb-2" />
        <div className="h-3 bg-[var(--muted-bg)] rounded w-40" />
      </div>
    )
  }

  if (error || !weather) return null

  return (
    <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <span>🌤️</span> Match Weather
        </h3>
        {venue && (
          <span className="text-xs text-[var(--text-tertiary)]">{venue}</span>
        )}
      </div>

      {/* Main Weather Display */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <span className="text-5xl">{getWeatherIcon(weather.icon)}</span>
            <div>
              <p className="text-3xl font-bold text-[var(--text-primary)]">
                {Math.round(weather.temperature)}°C
              </p>
              <p className="text-sm text-[var(--text-secondary)]">
                {weather.description}
              </p>
              <p className="text-xs text-[var(--text-tertiary)]">
                Feels like {Math.round(weather.feelsLike)}°C
              </p>
            </div>
          </div>
        </div>

        {/* Weather Details Grid */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-[var(--muted-bg)] rounded-lg p-3 text-center">
            <p className="text-2xl mb-1">💨</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {weather.windSpeed} km/h
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">
              {WIND_DIRECTIONS[weather.windDirection] || ''} {weather.windDirection}
            </p>
          </div>
          <div className="bg-[var(--muted-bg)] rounded-lg p-3 text-center">
            <p className="text-2xl mb-1">💧</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {weather.humidity}%
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">Humidity</p>
          </div>
          <div className="bg-[var(--muted-bg)] rounded-lg p-3 text-center">
            <p className="text-2xl mb-1">🌧️</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {weather.precipitation ?? 0}%
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">Rain chance</p>
          </div>
        </div>

        {/* Impact Assessment */}
        {impact && (
          <div className={`rounded-lg p-3 border ${getImpactBg(impact.level)}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`font-semibold ${getImpactColor(impact.level)}`}>
                {impact.level.charAt(0).toUpperCase() + impact.level.slice(1)} Impact
              </span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-2">
              {impact.description}
            </p>
            {impact.factors.length > 0 && (
              <ul className="text-xs text-[var(--text-tertiary)] space-y-1">
                {impact.factors.map((factor, idx) => (
                  <li key={idx} className="flex items-start gap-1">
                    <span>•</span>
                    <span>{factor}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
