import { homedir } from "node:os";
import { join } from "node:path";

// design.md §7.2 — replaces the prior single data directory with proper XDG Base
// Directory resolution, so runtime data and committable profiles are physically
// separated (a repo can be published without carrying legacy data along with it).

function xdgDataHome(): string {
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
}

function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

export function resolveDataDir(): string {
  return process.env.LANE_DATA_DIR ?? join(xdgDataHome(), "lane");
}

export function resolveConfigDir(): string {
  return process.env.LANE_CONFIG_DIR ?? join(xdgConfigHome(), "lane");
}
