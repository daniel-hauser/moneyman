export class Timer {
  duration: number;
  startTime: number;

  constructor(public name: string) {
    this.startTime = performance.now();
  }

  end() {
    this.duration = performance.now() - this.startTime;
  }

  toString() {
    if (this.duration === undefined) {
      return this.name;
    }
    return `${this.name}, took ${(this.duration / 1000).toFixed(2)}s`;
  }
}
