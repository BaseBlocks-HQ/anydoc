import { useEffect, useRef } from "react";
import {
  BarChart,
  LineChart,
  PieChart,
  type BarSeriesOption,
  type LineSeriesOption,
  type PieSeriesOption,
} from "echarts/charts";
import type { EChartsOption } from "echarts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

import type { SpreadsheetRenderedChart } from "./model.js";

const CHART_COLORS = ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5"];

use([
  AriaComponent,
  BarChart,
  GridComponent,
  LegendComponent,
  LineChart,
  PieChart,
  SVGRenderer,
  TitleComponent,
  TooltipComponent,
]);

function chartOption(chart: SpreadsheetRenderedChart): EChartsOption {
  const horizontal = chart.series.length > 0 && chart.series.every(({ type }) => type === "bar");
  const cartesian = chart.series.some(({ type }) => type !== "pie");
  const legendPosition = chart.legend === "none" ? undefined : chart.legend;
  const series: Array<BarSeriesOption | LineSeriesOption | PieSeriesOption> = chart.series.map(
    (item) => {
      if (item.type === "pie") {
        return {
          data: chart.categories.map((name, index) => ({
            name,
            value: item.values[index] ?? 0,
          })),
          label: { show: false },
          name: item.name,
          radius: "55%",
          type: "pie",
        };
      }
      if (item.type === "line") {
        return { data: [...item.values], name: item.name, type: "line" };
      }
      return { data: [...item.values], name: item.name, type: "bar" };
    },
  );
  return {
    animation: false,
    aria: { enabled: true },
    backgroundColor: "#FFFFFF",
    color: CHART_COLORS,
    ...(cartesian
      ? {
          grid: {
            bottom: legendPosition === "bottom" ? 54 : 34,
            left: legendPosition === "left" ? 88 : 36,
            outerBoundsContain: "axisLabel",
            outerBoundsMode: "same",
            right: legendPosition === "right" ? 88 : 24,
            top: chart.title ? 54 : 24,
          },
        }
      : {}),
    legend:
      legendPosition === undefined
        ? { show: false }
        : {
            ...(legendPosition === "bottom" ? { bottom: 4 } : {}),
            ...(legendPosition === "left"
              ? { left: 4 }
              : legendPosition === "right"
                ? {}
                : { left: "center" }),
            orient:
              legendPosition === "left" || legendPosition === "right" ? "vertical" : "horizontal",
            type: "scroll",
            ...(legendPosition === "right" ? { right: 4 } : {}),
            ...(legendPosition === "left" || legendPosition === "right"
              ? { top: "middle" }
              : legendPosition === "top"
                ? { top: chart.title ? 30 : 4 }
                : {}),
          },
    series,
    textStyle: { color: "#222222", fontFamily: "Arial, sans-serif" },
    ...(chart.title
      ? {
          title: {
            left: "center",
            text: chart.title,
            textStyle: { fontSize: 14, fontWeight: 600 },
          },
        }
      : {}),
    tooltip: { trigger: cartesian ? "axis" : "item" },
    ...(cartesian
      ? {
          xAxis: horizontal
            ? { type: "value" as const }
            : {
                axisLabel: { interval: 0, overflow: "break", width: 96 },
                data: [...chart.categories],
                type: "category" as const,
              },
          yAxis: horizontal
            ? {
                axisLabel: { interval: 0, overflow: "truncate", width: 120 },
                data: [...chart.categories],
                type: "category" as const,
              }
            : { type: "value" as const },
        }
      : {}),
  };
}

export function NativeChart({
  chart,
  height,
  width,
}: Readonly<{
  chart: SpreadsheetRenderedChart;
  height: number;
  width: number;
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const instance = init(container, undefined, {
      height: Math.max(1, height),
      renderer: "svg",
      width: Math.max(1, width),
    });
    instance.setOption(chartOption(chart), { notMerge: true });
    return () => instance.dispose();
  }, [chart, height, width]);
  return (
    <div
      aria-label={chart.title ?? `${chart.type} chart`}
      ref={containerRef}
      role="img"
      style={{ height, overflow: "hidden", width }}
    />
  );
}
