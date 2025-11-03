'use client'

import useSWR from 'swr'
import { LoadingSpinner } from './LoadingSpinner'

const fetcher = (url: string) => fetch(url).then((res) => res.json())

interface Report {
  [key: string]: {
    precision: number
    recall: number
    'f1-score': number
    support: number
  }
}

interface Metrics {
  train_accuracy: number
  test_accuracy: number
  train_report: Report
  test_report: Report
  n_samples: number
}

export function ModelMetrics({ league }: { league: string }) {
  const { data, error } = useSWR<Metrics>(
    `/api/analytics/model_metrics/${league}`,
    fetcher
  )

  if (error) return <div>Failed to load metrics</div>
  if (!data) return <LoadingSpinner />

  const renderReportTable = (report: Report, title: string) => {
    const { accuracy, ...classes } = report as any;
    return (
      <div>
        <h3 className="text-xl font-semibold mb-2">{title}</h3>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              <th className="border-b p-2">Class</th>
              <th className="border-b p-2">Precision</th>
              <th className="border-b p-2">Recall</th>
              <th className="border-b p-2">F1-Score</th>
              <th className="border-b p-2">Support</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(classes).map(([className, metrics]) => {
              const typedMetrics = metrics as {
                precision: number;
                recall: number;
                'f1-score': number;
                support: number;
              };
              return (
                <tr key={className}>
                  <td className="border-b p-2">{className}</td>
                  <td className="border-b p-2">{typedMetrics.precision.toFixed(2)}</td>
                  <td className="border-b p-2">{typedMetrics.recall.toFixed(2)}</td>
                  <td className="border-b p-2">{typedMetrics['f1-score'].toFixed(2)}</td>
                  <td className="border-b p-2">{typedMetrics.support}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-2 text-right">
          <strong>Accuracy: {accuracy.toFixed(2)}</strong>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-secondary p-6 rounded-lg">
      <h2 className="text-2xl font-semibold mb-4">Model Performance</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {data.train_report && renderReportTable(data.train_report, 'Training Set')}
        {data.test_report && renderReportTable(data.test_report, 'Testing Set')}
      </div>
      <div className="mt-4">
        <p>Total samples used for training: {data.n_samples}</p>
      </div>
    </div>
  )
}
