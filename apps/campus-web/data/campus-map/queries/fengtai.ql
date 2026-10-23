[out:json][timeout:60];
(
  way({{bbox}})["building"];
  way({{bbox}})["highway"];
  way({{bbox}})["leisure"];
  way({{bbox}})["landuse"];
  way({{bbox}})["natural"];
  relation({{bbox}})["boundary"];
);
out body geom;
