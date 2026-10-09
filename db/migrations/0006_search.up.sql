-- BE-11 (Sprint 3): search and filters (PRD 3.2 recipes.search_tsv, 4.9 GET /recipes; D-034).
-- The vector holds the title, the ingredient names and the tag names, in two forms:
--   * plain words ('simple'), so a word matches while the user is still typing it ('голу' -> Голубцы);
--   * stems in the recipe language, so other word forms match ('яблоки' -> 'кислых яблок').
--     Ukrainian has no built-in stemmer; the Russian one stands in (it reduces 'яблуко' and
--     'яблука' to the same stem).
-- Letters are lower-cased and ё is folded into е on both sides. Triggers keep the vector current.

ALTER TABLE recipes ADD COLUMN search_tsv tsvector NOT NULL DEFAULT ''::tsvector;

-- System tags are named in the web locales (tags.<slug>); search needs the names too, in all four
-- interface languages (en ru uk sv). A test checks that this list matches the locale files.
CREATE FUNCTION system_tag_words(p_slug text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE p_slug
    WHEN 'soup' THEN 'Soup Суп Суп Soppa'
    WHEN 'main' THEN 'Main course Основное блюдо Основна страва Huvudrätt'
    WHEN 'salad' THEN 'Salad Салат Салат Sallad'
    WHEN 'breakfast' THEN 'Breakfast Завтрак Сніданок Frukost'
    WHEN 'baking' THEN 'Baking Выпечка Випічка Bakning'
    WHEN 'dessert' THEN 'Dessert Десерт Десерт Efterrätt'
    WHEN 'vegan' THEN 'Vegan Веган Веган Vegansk'
    WHEN 'gluten_free' THEN 'Gluten-free Без глютена Без глютену Glutenfri'
    WHEN 'lean' THEN 'Lenten Постное Пісне Fastemat'
  END $$;

CREATE FUNCTION search_fold(p text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT translate(lower(p), 'ё', 'е') $$;

CREATE FUNCTION search_stemmer(p_lang text) RETURNS regconfig
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE btrim(p_lang) WHEN 'en' THEN 'english' WHEN 'sv' THEN 'swedish' ELSE 'russian' END::regconfig $$;

-- Runs as the owner so it sees the whole recipe; callers reach it only through the triggers below
-- (which fire only on rows the caller may write).
CREATE FUNCTION recipe_search_vector(p_recipe_id uuid, p_title text, p_lang text) RETURNS tsvector
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH doc AS (
    SELECT search_fold(concat_ws(' ',
             p_title,
             (SELECT string_agg(i.name, ' ') FROM recipe_ingredients i WHERE i.recipe_id = p_recipe_id),
             (SELECT string_agg(coalesce(t.custom_name, system_tag_words(t.slug), t.slug), ' ')
                FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id = p_recipe_id)
           )) AS body)
  SELECT to_tsvector('simple', body) || to_tsvector(search_stemmer(p_lang), body) FROM doc $$;
REVOKE ALL ON FUNCTION recipe_search_vector(uuid, text, text) FROM PUBLIC;

CREATE FUNCTION recipes_search_row() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.search_tsv := recipe_search_vector(NEW.id, NEW.title, NEW.language);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION recipes_search_row() FROM PUBLIC;
CREATE TRIGGER recipes_search BEFORE INSERT OR UPDATE OF title, language ON recipes
  FOR EACH ROW EXECUTE FUNCTION recipes_search_row();

-- Ingredients and tags: once per statement for every recipe the statement touched.
CREATE FUNCTION recipes_search_refresh() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE recipes r SET search_tsv = recipe_search_vector(r.id, r.title, r.language)
   WHERE r.id IN (SELECT DISTINCT c.recipe_id FROM changed c);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION recipes_search_refresh() FROM PUBLIC;
CREATE TRIGGER recipe_ingredients_search_ins AFTER INSERT ON recipe_ingredients
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION recipes_search_refresh();
CREATE TRIGGER recipe_ingredients_search_upd AFTER UPDATE ON recipe_ingredients
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION recipes_search_refresh();
CREATE TRIGGER recipe_ingredients_search_del AFTER DELETE ON recipe_ingredients
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION recipes_search_refresh();
CREATE TRIGGER recipe_tags_search_ins AFTER INSERT ON recipe_tags
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION recipes_search_refresh();
CREATE TRIGGER recipe_tags_search_del AFTER DELETE ON recipe_tags
  REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION recipes_search_refresh();

UPDATE recipes SET search_tsv = recipe_search_vector(id, title, language);
CREATE INDEX recipes_search_idx ON recipes USING gin (search_tsv);

-- The query side. The API splits the user's text into words (letters and digits only, at most 8);
-- each word must match as a prefix, either as typed or as a stem in Russian, English or Swedish.
-- quote_literal keeps every word a single lexeme, so nothing in it is read as a query operator.
CREATE FUNCTION recipe_search_query(p_words text[]) RETURNS tsquery
  LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, public AS $$
DECLARE
  w text;
  term tsquery;
  result tsquery;
BEGIN
  FOREACH w IN ARRAY p_words[1:8] LOOP
    w := search_fold(left(w, 40));
    CONTINUE WHEN w IS NULL OR btrim(w) = '';
    w := quote_literal(w) || ':*';
    term := to_tsquery('simple', w) || to_tsquery('russian', w)
         || to_tsquery('english', w) || to_tsquery('swedish', w);
    result := CASE WHEN result IS NULL THEN term ELSE result && term END;
  END LOOP;
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION recipe_search_query(text[]) TO cookbook_app;
