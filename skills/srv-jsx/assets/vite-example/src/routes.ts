import { get, route } from "remix/fetch-router/routes";

export const routes = route({
  home: get("/"),
  partial: get("/partial"),
  404: "*",
});
