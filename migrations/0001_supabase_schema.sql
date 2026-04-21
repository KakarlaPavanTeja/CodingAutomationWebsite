--
-- PostgreSQL database dump
--

\restrict hLjroUjHVP9HmzpSURjYXI0783kfVQ9d7nUHcib9f9ELGlSruqgSUh9QytdRrM5

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    'problem_setter'
  );
  RETURN NEW;
END;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auth_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_audit_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    ip_address text,
    user_agent text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: llm_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_usage (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    problem_id uuid,
    user_id uuid,
    model text NOT NULL,
    purpose text NOT NULL,
    prompt_tokens integer DEFAULT 0 NOT NULL,
    completion_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    cost_usd numeric(10,6) DEFAULT 0 NOT NULL,
    problem_name text,
    created_at timestamp with time zone DEFAULT now(),
    step_id text
);


--
-- Name: pipeline_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    problem_id uuid,
    step_id text NOT NULL,
    run_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: pipeline_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_runs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    problem_id uuid NOT NULL,
    user_id uuid NOT NULL,
    step_id text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    exit_code integer,
    started_at timestamp with time zone DEFAULT now(),
    finished_at timestamp with time zone,
    logs_summary text,
    pid integer,
    CONSTRAINT pipeline_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: pipeline_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_states (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    problem_id uuid NOT NULL,
    user_id uuid NOT NULL,
    question_type text DEFAULT 'function'::text NOT NULL,
    mode text DEFAULT 'practice'::text NOT NULL,
    enabled_languages text[] DEFAULT '{Python,C++,Java,Node.js}'::text[],
    testcase_count integer DEFAULT 48,
    step_configs jsonb DEFAULT '{}'::jsonb,
    step_statuses jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: problems; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.problems (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    created_by uuid NOT NULL,
    name text NOT NULL,
    question_type text NOT NULL,
    mode text NOT NULL,
    scenario_level text DEFAULT 'none'::text NOT NULL,
    languages text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    storage_path text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deletion_reason text,
    deleted_at timestamp with time zone,
    CONSTRAINT problems_mode_check CHECK ((mode = ANY (ARRAY['practice'::text, 'exam'::text]))),
    CONSTRAINT problems_question_type_check CHECK ((question_type = ANY (ARRAY['function'::text, 'nonfunction'::text]))),
    CONSTRAINT problems_scenario_level_check CHECK ((scenario_level = ANY (ARRAY['none'::text, 'light'::text, 'moderate'::text, 'heavy'::text]))),
    CONSTRAINT problems_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'deletion_pending'::text, 'deleted'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    display_name text,
    role text DEFAULT 'problem_setter'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'problem_setter'::text]))),
    CONSTRAINT profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'left'::text, 'pending_approval'::text, 'deactivated'::text])))
);


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limits (
    key text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    reset_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_audit_log auth_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit_log
    ADD CONSTRAINT auth_audit_log_pkey PRIMARY KEY (id);


--
-- Name: llm_usage llm_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_usage
    ADD CONSTRAINT llm_usage_pkey PRIMARY KEY (id);


--
-- Name: pipeline_logs pipeline_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_logs
    ADD CONSTRAINT pipeline_logs_pkey PRIMARY KEY (id);


--
-- Name: pipeline_logs pipeline_logs_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_logs
    ADD CONSTRAINT pipeline_logs_run_id_key UNIQUE (run_id);


--
-- Name: pipeline_runs pipeline_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_pkey PRIMARY KEY (id);


--
-- Name: pipeline_states pipeline_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_states
    ADD CONSTRAINT pipeline_states_pkey PRIMARY KEY (id);


--
-- Name: pipeline_states pipeline_states_problem_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_states
    ADD CONSTRAINT pipeline_states_problem_id_key UNIQUE (problem_id);


--
-- Name: problems problems_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.problems
    ADD CONSTRAINT problems_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (key);


--
-- Name: idx_audit_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_event ON public.auth_audit_log USING btree (event_type, created_at DESC);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.auth_audit_log USING btree (user_id, created_at DESC);


--
-- Name: idx_llm_usage_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_created_at ON public.llm_usage USING btree (created_at DESC);


--
-- Name: idx_llm_usage_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_model ON public.llm_usage USING btree (model);


--
-- Name: idx_llm_usage_problem_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_problem_id ON public.llm_usage USING btree (problem_id);


--
-- Name: idx_llm_usage_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_usage_user_id ON public.llm_usage USING btree (user_id);


--
-- Name: idx_rate_limits_reset_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limits_reset_at ON public.rate_limits USING btree (reset_at);


--
-- Name: auth_audit_log auth_audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit_log
    ADD CONSTRAINT auth_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: llm_usage llm_usage_problem_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_usage
    ADD CONSTRAINT llm_usage_problem_id_fkey FOREIGN KEY (problem_id) REFERENCES public.problems(id) ON DELETE SET NULL;


--
-- Name: llm_usage llm_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_usage
    ADD CONSTRAINT llm_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: pipeline_logs pipeline_logs_problem_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_logs
    ADD CONSTRAINT pipeline_logs_problem_id_fkey FOREIGN KEY (problem_id) REFERENCES public.problems(id) ON DELETE CASCADE;


--
-- Name: pipeline_logs pipeline_logs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_logs
    ADD CONSTRAINT pipeline_logs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.pipeline_runs(id) ON DELETE CASCADE;


--
-- Name: pipeline_runs pipeline_runs_problem_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_problem_id_fkey FOREIGN KEY (problem_id) REFERENCES public.problems(id) ON DELETE CASCADE;


--
-- Name: pipeline_runs pipeline_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: pipeline_states pipeline_states_problem_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_states
    ADD CONSTRAINT pipeline_states_problem_id_fkey FOREIGN KEY (problem_id) REFERENCES public.problems(id) ON DELETE CASCADE;


--
-- Name: pipeline_states pipeline_states_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_states
    ADD CONSTRAINT pipeline_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: problems problems_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.problems
    ADD CONSTRAINT problems_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: llm_usage Admins can read all usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all usage" ON public.llm_usage FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: profiles Admins can update profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update profiles" ON public.profiles FOR UPDATE USING (public.is_admin());


--
-- Name: profiles Admins can view all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.is_admin());


--
-- Name: auth_audit_log Admins can view audit log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view audit log" ON public.auth_audit_log FOR SELECT USING (public.is_admin());


--
-- Name: problems Admins see all problems; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins see all problems" ON public.problems FOR SELECT USING (public.is_admin());


--
-- Name: pipeline_runs Admins see all runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins see all runs" ON public.pipeline_runs FOR SELECT USING (public.is_admin());


--
-- Name: pipeline_states Admins see all states; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins see all states" ON public.pipeline_states FOR SELECT USING (public.is_admin());


--
-- Name: llm_usage Admins see all usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins see all usage" ON public.llm_usage FOR SELECT USING (public.is_admin());


--
-- Name: llm_usage Service role full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access" ON public.llm_usage USING (true) WITH CHECK (true);


--
-- Name: llm_usage Users can read own usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own usage" ON public.llm_usage FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: problems Users insert own problems; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert own problems" ON public.problems FOR INSERT WITH CHECK ((created_by = auth.uid()));


--
-- Name: pipeline_runs Users insert own runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert own runs" ON public.pipeline_runs FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: llm_usage Users insert own usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert own usage" ON public.llm_usage FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: pipeline_states Users manage own states; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own states" ON public.pipeline_states USING ((user_id = auth.uid()));


--
-- Name: problems Users see own problems; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own problems" ON public.problems FOR SELECT USING ((created_by = auth.uid()));


--
-- Name: pipeline_runs Users see own runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own runs" ON public.pipeline_runs FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: llm_usage Users see own usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own usage" ON public.llm_usage FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: problems Users update own problems; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own problems" ON public.problems FOR UPDATE USING ((created_by = auth.uid()));


--
-- Name: pipeline_runs Users update own runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own runs" ON public.pipeline_runs FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: auth_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: llm_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.llm_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_states ENABLE ROW LEVEL SECURITY;

--
-- Name: problems; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.problems ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict hLjroUjHVP9HmzpSURjYXI0783kfVQ9d7nUHcib9f9ELGlSruqgSUh9QytdRrM5

