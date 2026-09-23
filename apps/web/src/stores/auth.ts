import { defineStore } from "pinia";
import type { SafeUser, TeamDto } from "@yeah/shared";
import { api } from "../lib/api";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as SafeUser | null,
    teams: [] as TeamDto[],
    loaded: false,
    // Whether "/register" is still usable at all — yeah is single-admin, so this flips to false
    // forever the moment the first (only) account exists. See apps/api/src/routes/auth.ts.
    needsSetup: false,
    setupChecked: false,
  }),
  actions: {
    async fetchMe() {
      try {
        const { user } = await api.get<{ user: SafeUser }>("/auth/me");
        this.user = user;
        await this.fetchTeams();
      } catch {
        this.user = null;
      } finally {
        this.loaded = true;
      }
    },
    async checkSetup() {
      try {
        const { needsSetup } = await api.get<{ needsSetup: boolean }>("/auth/setup-status");
        this.needsSetup = needsSetup;
      } catch {
        this.needsSetup = false;
      } finally {
        this.setupChecked = true;
      }
    },
    async fetchTeams() {
      const { teams } = await api.get<{ teams: TeamDto[] }>("/teams");
      this.teams = teams;
    },
    async login(email: string, password: string) {
      const { user } = await api.post<{ user: SafeUser }>("/auth/login", { email, password });
      this.user = user;
      this.loaded = true;
      await this.fetchTeams();
    },
    async register(email: string, password: string, name?: string) {
      const { user } = await api.post<{ user: SafeUser }>("/auth/register", { email, password, name });
      this.user = user;
      this.loaded = true;
      this.needsSetup = false;
      await this.fetchTeams();
    },
    async logout() {
      await api.post("/auth/logout");
      this.user = null;
      this.teams = [];
    },
    async createTeam(name: string) {
      const { team } = await api.post<{ team: TeamDto }>("/teams", { name });
      this.teams.push(team);
      return team;
    },
    async renameTeam(teamId: string, name: string) {
      const { team } = await api.put<{ team: TeamDto }>(`/teams/${teamId}`, { name });
      const index = this.teams.findIndex((t) => t.id === teamId);
      if (index !== -1) this.teams[index] = team;
      return team;
    },
  },
});
