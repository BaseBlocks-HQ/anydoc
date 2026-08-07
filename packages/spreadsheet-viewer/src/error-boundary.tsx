import { Component, type ErrorInfo, type ReactNode } from "react";

export class SpreadsheetErrorBoundary extends Component<
  Readonly<{
    children: ReactNode;
    fallback?: ReactNode;
    scope: "object" | "sheet" | "workbook";
  }>,
  Readonly<{ error: Error | null }>
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Spreadsheet ${this.props.scope} rendering failed.`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      this.props.fallback ?? (
        <div role="alert" style={{ padding: 16 }}>
          This {this.props.scope} could not be displayed. The rest of the workbook is still
          available.
        </div>
      )
    );
  }
}
