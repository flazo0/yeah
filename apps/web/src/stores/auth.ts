import { defineStore } from "pinia";
import type { SafeUser, TeamDto } from "@yeah/shared";
import { api } from "../lib/api";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as SafeUser | null,
    teams: [] as TeamDto[],
    loaded: false,
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
  },
});
